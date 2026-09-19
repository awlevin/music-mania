# Modes

A proposal for three ways to play, and the one change to the game core that
makes all of them the same game.

| Mode            | Screen that plays the music        | Who answers                 | Where the reveal shows   |
| --------------- | ---------------------------------- | --------------------------- | ------------------------ |
| **Living room** | A TV or laptop (today's host)      | Everyone, from their phones | The TV                   |
| **Aux**         | One phone, on the car stereo or a speaker | Everyone, that phone included | Every phone              |
| **Solo**        | Your own phone or laptop           | You                         | The same screen          |

"Aux" is the proposed name for the car one. Pass-the-aux is the thing that
actually happens: one phone is on the speakers, and it works the same in a
car, a kitchen, or a picnic with a Bluetooth speaker. "Road trip" is the
runner-up; it names one place rather than the mechanic.

## The one core idea: the DJ

Today the code has two roles and they map one-to-one onto two kinds of device:

- **host** — holds `hostToken`, gets `previewUrl` in its view, runs the
  jukebox, sends `audio-started`, never answers.
- **player** — holds a seat token, answers, never hears a preview URL.

Every mode above is just a different assignment of those two roles to devices:

- Living room: host = the TV, players = the phones. (Unchanged.)
- Aux: host duties *and* a player seat live on one phone.
- Solo: the same as Aux, with exactly one seat, and the lobby skipped.

So the proposal is to let one player carry the host duties. Call that player
the **DJ**. A room in Aux or Solo mode has no host token holder at all; it has
a DJ instead. Everything else in the reducer (deadlines, `tick`, pause,
compare-and-set, per-recipient views) is untouched, and a phone that is not
the DJ is exactly today's phone.

### State

```ts
// lib/game/types.ts
export type Mode = 'tv' | 'aux' | 'solo';

export interface RoomState {
  // ...
  mode: Mode;
  /** Aux and solo: the player whose device plays the music. Null in tv mode. */
  dj: string | null;
}
```

`createRoom` takes the mode. Tv rooms keep working exactly as now (`dj: null`).
In aux and solo rooms a `hostToken` is still generated, because the type
requires one, but it is never handed to anybody; `identify` can therefore
never return `{ role: 'host' }` for those rooms.

### Viewer

```ts
// lib/game/views.ts
export type Viewer =
  | { role: 'host' }
  | { role: 'player'; playerId: string; dj: boolean };
```

`identify` sets `dj: state.dj === player.id`. In `viewFor`, every place that
checks `viewer.role === 'host'` for audio material (`previewUrl`,
`nextPreviewUrl`, `finaleUrls`, `lobbyUrl`) checks `plays(viewer)` instead:

```ts
const plays = (v: Viewer) => v.role === 'host' || v.dj;
```

The answer itself still waits for the reveal for everyone, DJ included. The
DJ sees a preview URL before the reveal, which is the same trust the TV has
today; iTunes preview URLs do not name the song.

`RoomView.you` gains `dj: boolean` and `RoomView` gains `mode`, so the phone
knows whether to mount the jukebox and how to word things.

### Actions

- `audio-started` and `audio-failed` are accepted from the DJ as well as the
  host (`app/api/rooms/[code]/actions/route.ts`, the `viewer.role === 'host'`
  branch).
- `join` is refused when `mode === 'solo'` ("This is a solo game.").
- `remove-player` / `leave` on the DJ: the reducer promotes the next player
  (`dj = players[0]?.id ?? null`) so the room is never stranded waiting for a
  device that has gone. The promoted phone sees `you.dj` flip to true, mounts
  the jukebox, and shows the existing "Turn sound on" gate, because no click
  has unlocked audio there yet.
- New: `{ type: 'pass-aux', playerId }`, allowed from the current DJ or the
  leader. Same effect, chosen rather than forced. Hand the phone to whoever has
  the cable.

Nothing else in `reduce` changes. `allAnswered` already ends a round the
moment the last seat answers, which is what makes Solo work with no special
casing: one seat, one answer, instant reveal.

### Creating a room

`POST /api/rooms` takes `{ mode, heard, name? }`:

- `tv`: as today. Returns `{ code, hostToken }`.
- `aux`: opens the room, joins `name` as the first player, sets `dj` to that
  player, returns `{ code, playerId, token }`. The phone stores the seat with
  `seats.set(code, token)` and goes to `/play/CODE`. Being first in, the DJ
  is also the leader, so Start is on their phone already.
- `solo`: as `aux`, then dispatches `start` in the same request, so the first
  thing the player sees is "Get ready to name the song". The click on the
  landing page is the one that unlocks audio, exactly as "Host a game" does
  now (`getJukebox().unlock()` in `components/Landing.tsx`).

`openRoom` in `lib/realtime/rooms.ts` grows a `mode` argument; the join and
start happen through `dispatch`, so they get the usual compare-and-set.

## Aux mode, screen by screen

All of it lives in `components/play/PlayScreen.tsx` and one new hook; the
route stays `/play/[code]`, so a reload recovers the seat as it does now.

**The DJ's phone runs the director.** `useDirector` (`components/host/useDirector.ts`)
already takes `(code, token, view, clockOffset, lobbyMusic)` and sends
`audio-started` with whatever token it is given. Mount it in `Room` when
`view.you.dj` is true. Move it to `lib/client/useDirector.ts` since it is no
longer host-only. The DJ ticks with delay 0 like the TV; other phones keep
their staggered delay.

**Sound gate.** Port the "The sound is off / Turn sound on" block from
`HostScreen` into `PlayScreen`, shown only for the DJ. Phone browsers are
stricter than desktop ones about this, and the jukebox's silent-clip priming
(`lib/client/jukebox.ts`, `unlock`) is already written for Safari.

**Keep the screen on.** Mobile browsers freeze JavaScript when the screen
locks. The current song keeps playing, but the next one is never cued, and the
room sits in `loading` waiting for `audio-started`. Two layers:

1. `navigator.wakeLock.request('screen')` on the DJ's phone while the game
   runs, re-requested on `visibilitychange` (Safari 16.4+, HTTPS only, drops
   when the tab is hidden).
2. A stall notice: if `loading` has lasted more than ~10 s on the server clock,
   non-DJ phones show "Waiting on Ana's phone" and the leader gets a
   *Pass the aux* button. Cheap, and it makes the failure explainable.

**Do not leak the answer on the dashboard.** This one is easy to miss. A car
head unit shows whatever the phone's media session reports, and so does a
Bluetooth speaker with a display. Set it explicitly whenever a song is cued:

```ts
navigator.mediaSession.metadata = new MediaMetadata({
  title: 'Music Mania',
  artist: `Song ${index + 1} of ${total}`,
});
```

Same for `document.title` on the play page. The song's real title goes in
only at the reveal, if at all.

**Lobby.** The leader's phone already has Start and the player list. Add the
room code, large, and a *Share link* key that calls `navigator.share` with
`${origin}/play/CODE` (falls back to copying it). Phones in the back seat get
a text message instead of a QR code.

**Reveal.** Every phone becomes the scoreboard. `RevealView` shows your
verdict, the answer and your standing; add the round's board underneath, the
same `PlayerChip` list the TV draws (`rankPlayers`, `answerNote`, the star for
fastest). Worth doing in every mode, not just aux.

**Bluetooth latency.** A stereo adds 100–300 ms between `play()` resolving
and sound reaching ears. `ANSWER_GRACE_MS` covers the network side; the
speed-points curve is gentle enough that this does not need its own knob in a
first version.

**End-to-end test.** `e2e/game.mjs` asserts that no phone holds a media
element. Under aux mode the DJ's phone must, so the assertion skips the DJ.
Add a second run of the script with `MODE=aux` and three phones, no host page.

## Solo mode

Solo is aux with one seat and no lobby, so nearly everything above carries
over. What is specific to it:

- A *Play solo* key on the landing page next to *Host a game*. One click:
  create, join, start.
- Copy: "Right, and first" becomes "Right"; "Waiting for 0 more" and "You are
  1st of 1" are hidden when `mode === 'solo'`.
- The reveal still auto-advances after `REVEAL_MS`, and *Next song* is there
  to skip it. Ten songs takes about five minutes.
- *Play again* on the finished screen already exists for the leader; in solo
  it draws ten new songs into the same room and the `heard` list keeps them
  fresh across sessions.
- The finale playlist plays over the final score, as on the TV. Keep it: it
  is the reward.

Later, per-mode rules (five songs for a quick play, a shorter reveal) belong
in a `rules` block on the room, derived from the mode at creation, and read
by the screens from the view instead of from `config.ts` constants. Not for
the first version: `GUESS_MS` and `REVEAL_MS` are read in six client files,
and a mode field on the room is enough to start.

## The daily challenge and the leaderboard

Solo is the base; the daily is a solo game whose songs are fixed for the day.

**Same songs for everyone.** `chooseSongs` already takes a `random` function.
Seed a small PRNG from the date (`mulberry32(hash('2026-09-19'))`) and every
draw that day is the same ten songs, spares included, with the no-artist-twice
rule intact. One catch: the benched set (`benchedSongIds`) can change during
the day, which would change the draw. So the first request of the day snapshots
the song ids into Redis (`SET mm:daily:2026-09-19 ... NX`) and every later
room reads the snapshot. Days roll over at midnight UTC; say so on the page.

**Scoring stays on the server.** This is the reason the daily reuses rooms
rather than a client-only game: the answer never reaches the phone before the
reveal, and `grade` runs in the reducer, so a score is something the server
computed, not something the phone reported.

**Recording a score.** In `dispatch`, after a successful write, if
`prev.phase !== 'finished' && next.phase === 'finished' && next.mode === 'daily'`,
add the score to the day's board:

```
ZADD mm:daily:2026-09-19:board <score> <profileId>
SET  mm:daily:2026-09-19:entry:<profileId> {name, score, at}
```

Ranks come from `ZREVRANK`, the top hundred from `ZREVRANGE ... WITHSCORES`.
Same shape as `lib/feedback/store.ts`, with a process-local fallback for dev.

**One go per day.** A profile id in localStorage (`mm:profile`, generated on
first visit, sent when creating a daily room). The server refuses a second
daily room for the same profile (`SET mm:daily:<date>:played:<profileId> NX`).
This is a party game, not a tournament: clearing site data buys another go,
and that is fine. The leaderboard shows the name the player typed, the way the
scoreboard does now.

**Screens.** A `/daily` page with today's leaderboard, your rank if you have
played, and the *Play today's ten* key (disabled with "Come back tomorrow"
once you have). The finished screen in a daily room shows your rank in place
of the party finale, then the board.

`mode` grows a fourth value, `'daily'`, that behaves as `'solo'` everywhere
except song selection and the finish hook.

## Landing page

Three ways in, and the join box that most phones are here for:

```
On the TV or laptop      →  Host a game          (tv)
Everyone on phones       →  Start on this phone  (aux)   "One phone plays the music."
Just you                 →  Play solo            (solo)  "Ten songs, five minutes."
                            Today's challenge    (daily) with today's top score

On your phone            →  [ Room code ] Join
```

On a phone-sized viewport, put Aux and Solo first; on a desktop viewport, put
Host first. The name field for aux and solo can reuse `lastName`, so most of
the time it is prefilled.

## Order of work

1. **Core** — `mode`, `dj`, `Viewer.dj`, `plays()`, the route changes, DJ
   promotion, `pass-aux`. Tests in `lib/game/game.test.ts`: a DJ's view carries
   `previewUrl`, a non-DJ's does not; solo refuses `join`; removing the DJ
   promotes the next player. Nothing visible changes yet; tv rooms are
   byte-for-byte the same.
2. **Aux** — director on the DJ phone, sound gate, wake lock, media session,
   share link, scoreboard on the reveal, stall notice, e2e run.
3. **Solo** — landing key, one-request create-join-start, copy.
4. **Daily** — seeded draw with snapshot, profile id, board store, `/daily`
   page, finish hook.

Steps 1 to 3 are one pull request each and each leaves `main` playable. Step
4 is the first thing in the project that keeps data past a room's six-hour
life, which is why it comes last and on its own.

## Things deliberately not done

- **A separate client-only solo game.** It would need the answer on the
  phone, which rules out any leaderboard, and it would be a second copy of the
  round loop. The room costs one Redis key and one event stream per player;
  that is cheap enough.
- **Phones that play audio in tv mode.** The e2e test's "phones are silent"
  rule stays for every phone that is not the DJ.
- **Accounts.** The daily uses a local profile id. Real identity can come
  later and slot into the same board keys.
