'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Field, IconButton, Key, PauseIcon, PlayerChip, TitleStrip, Wordmark } from '@/components/ds';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { Confetti } from '@/components/host/Confetti';
import { send } from '@/lib/client/api';
import { useSettings } from '@/lib/client/settings';
import { heard, lastName, seats, soloBest } from '@/lib/client/storage';
import { type Director, useDirector } from '@/lib/client/useDirector';
import { useJoinUrl } from '@/lib/client/useJoinUrl';
import { useLinerNote } from '@/lib/client/useLinerNote';
import { useServerNow } from '@/lib/client/useNow';
import { useRoom } from '@/lib/client/useRoom';
import { GUESS_MS, MAX_ANSWER_LENGTH, MAX_NAME_LENGTH, REVEAL_MS } from '@/lib/game/config';
import { gradeRun } from '@/lib/game/grades';
import { KINDS } from '@/lib/game/kinds';
import { rankPlayers } from '@/lib/game/rank';
import type { RevealedAnswer, RoomView } from '@/lib/game/types';

import styles from './play.module.css';

const noStore = () => () => {};

/** Phones back the TV up as timekeepers, each a little later than the last. */
const tickDelay = 400 + Math.floor(Math.random() * 900);

/** A round that has been loading this long is waiting on a phone that has dozed off. */
const STALL_MS = 15_000;

export function PlayScreen({ code }: { code: string }) {
  const [, rerender] = useState(0);
  const [notice, setNotice] = useState('');
  // undefined while the server renders; null when this phone has no seat yet.
  const token = useSyncExternalStore(
    noStore,
    () => seats.get(code),
    () => undefined,
  );

  if (token === undefined) return <main className={styles.page} aria-busy />;

  if (token === null) {
    return (
      <JoinForm
        code={code}
        notice={notice}
        onJoined={(next) => {
          seats.set(code, next);
          setNotice('');
          rerender((n) => n + 1);
        }}
      />
    );
  }

  return (
    <Room
      key={token}
      code={code}
      token={token}
      onSeatLost={(why) => {
        seats.clear(code);
        setNotice(why);
        rerender((n) => n + 1);
      }}
    />
  );
}

// ---------------------------------------------------------------------------

interface ShellProps {
  code: string;
  children: React.ReactNode;
  tone?: string;
  token?: string;
  /** Title of the song on screen, once revealed. Feedback is offered then, about it or anything. */
  songTitle?: string;
  /** Shown while a clock is running. */
  onPause?: () => void;
  /** What the corner says instead of the room code. */
  corner?: React.ReactNode;
}

function Shell({ code, children, tone, token, songTitle, onPause, corner }: ShellProps) {
  const [feedback, setFeedback] = useState(false);
  return (
    <main className={styles.page} data-tone={tone}>
      <header className={styles.top}>
        <Wordmark className={styles.topMark} href="/" />
        <div className={styles.topEnd}>
          <span className={styles.topCode}>{corner ?? `Room ${code}`}</span>
          {onPause && (
            <IconButton label="Pause the game" onClick={onPause}>
              <PauseIcon />
            </IconButton>
          )}
        </div>
      </header>
      {children}
      {songTitle && (
        <footer className={styles.foot}>
          <button type="button" className={styles.footLink} onClick={() => setFeedback(true)}>
            Send feedback
          </button>
        </footer>
      )}
      {feedback && (
        <FeedbackSheet code={code} token={token} songTitle={songTitle} onClose={() => setFeedback(false)} />
      )}
    </main>
  );
}

function JoinForm({
  code,
  notice,
  onJoined,
}: {
  code: string;
  notice: string;
  onJoined: (token: string) => void;
}) {
  const [name, setName] = useState(() => lastName.get());
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [closed, setClosed] = useState(false);

  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || joining) return;
    setJoining(true);
    setError('');
    const result = await send(code, null, { type: 'join', name });
    setJoining(false);
    if (!result.ok) {
      if (result.status === 404) setClosed(true);
      else setError(result.error);
      return;
    }
    lastName.set(name.trim());
    onJoined(String(result.data.token));
  };

  if (closed) {
    return (
      <Shell code={code}>
        <section className={styles.centre}>
          <h1 className={styles.headline}>No room called {code}</h1>
          <p className={styles.sub}>Check the four letters on the host screen, or scan its code again.</p>
          <Link href="/" className={styles.link}>
            Enter another code
          </Link>
        </section>
      </Shell>
    );
  }

  return (
    <Shell code={code} tone="artist">
      <form className={styles.centre} onSubmit={join}>
        <h1 className={styles.headline}>Who is playing?</h1>
        <p className={styles.sub}>{notice || 'Your name goes on the scoreboard.'}</p>
        <Field
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
          placeholder="Your name"
          aria-label="Your name"
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          autoFocus
          enterKeyHint="go"
        />
        <Key type="submit" block disabled={!name.trim() || joining}>
          {joining ? 'Joining…' : 'Join game'}
        </Key>
        <p className={styles.error} role="alert">
          {error}
        </p>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------------------

/** True once a round has sat in `loading` long enough that the DJ's phone is probably asleep. */
function useStalled(view: RoomView | null): boolean {
  const key = view?.phase === 'loading' && !view.pause ? `${view.code}:${view.round?.index}` : '';
  /** The round that has been waiting too long, if the current one is it. */
  const [stalledKey, setStalledKey] = useState('');
  useEffect(() => {
    if (!key) return;
    const timer = setTimeout(() => setStalledKey(key), STALL_MS);
    return () => clearTimeout(timer);
  }, [key]);
  return key !== '' && stalledKey === key;
}

function Room({
  code,
  token,
  onSeatLost,
}: {
  code: string;
  token: string;
  onSeatLost: (why: string) => void;
}) {
  const { view, status, clockOffset } = useRoom(code, token, tickDelay);
  const dj = Boolean(view?.you?.dj);

  const settings = useSettings();
  const director = useDirector(code, dj ? token : null, view, clockOffset, settings.lobbyMusic);
  const stalled = useStalled(view);
  const [roomGone, setRoomGone] = useState(false);

  // The phone on aux remembers every song it played, so later games skip them.
  const revealedSongId = dj ? view?.round?.song?.id : undefined;
  useEffect(() => {
    if (revealedSongId) heard.add(revealedSongId);
  }, [revealedSongId]);

  useEffect(() => {
    if (status === 'removed') onSeatLost('The host removed you. Join again if that was a mistake.');
    if (status !== 'closed') return;
    // The stream was refused. Ask the API why: no room, or no seat in it.
    let cancelled = false;
    send(code, token, { type: 'tick' }).then((result) => {
      if (cancelled || result.ok) return;
      if (result.status === 401) onSeatLost('Your seat in this room is gone. Join again.');
      else if (result.status === 404) setRoomGone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [status, code, token, onSeatLost]);

  if (roomGone) {
    return (
      <Shell code={code}>
        <section className={styles.centre}>
          <h1 className={styles.headline}>This room has closed</h1>
          <p className={styles.sub}>Ask the host to start a new one, then scan its code.</p>
          <Link href="/" className={styles.link}>
            Enter another code
          </Link>
        </section>
      </Shell>
    );
  }

  if (!view?.you) return <Shell code={code}>{null}</Shell>;

  const me = view.players.find((p) => p.id === view.you!.id);
  const solo = view.mode === 'solo';
  const inPlay = view.phase !== 'lobby' && view.phase !== 'finished';
  return (
    <Shell
      code={code}
      tone={view.round?.kind}
      token={token}
      songTitle={view.phase === 'reveal' ? view.round?.song?.title : undefined}
      corner={
        solo ? (
          view.round && inPlay ? `Song ${view.round.index + 1} of ${view.round.total}` : 'Solo'
        ) : dj ? (
          <>
            Room {code} <AuxTag />
          </>
        ) : undefined
      }
      onPause={
        !view.pause && (view.phase === 'guessing' || view.phase === 'reveal')
          ? () => void send(code, token, { type: 'pause' })
          : undefined
      }
    >
      {view.pause && <PausedView view={view} token={token} />}
      {me && view.phase !== 'lobby' && !(solo && view.phase === 'finished') && (
        <div className={styles.me}>
          <span>{solo ? 'Your score' : me.name}</span>
          <strong>{me.score.toLocaleString('en-US')}</strong>
        </div>
      )}
      {view.phase === 'lobby' && (
        <LobbyView view={view} token={token} director={director} onLeft={() => onSeatLost('')} />
      )}
      {view.phase === 'loading' && <LoadingView view={view} token={token} stalled={stalled} />}
      {view.phase === 'guessing' && (
        <GuessView key={view.round!.index} view={view} token={token} clockOffset={clockOffset} />
      )}
      {view.phase === 'reveal' && <RevealView view={view} token={token} clockOffset={clockOffset} />}
      {view.phase === 'finished' && <FinishedView view={view} token={token} director={director} />}

      {/* The phone on aux was reloaded, or handed the aux mid-game: it needs one tap before it can play. */}
      {director.needsClick && inPlay && (
        <div className={styles.soundGate} role="dialog" aria-modal aria-label="Turn the sound on">
          <h2>The sound is off</h2>
          <p>Phones keep quiet until somebody taps. Everyone is waiting on this one.</p>
          <Key onClick={() => void director.enableSound()}>Turn sound on</Key>
        </div>
      )}
      {status === 'reconnecting' && <div className={styles.toast}>Reconnecting…</div>}
    </Shell>
  );
}

/** The little lamp on the phone that is plugged in. */
function AuxTag() {
  return (
    <span className={styles.auxTag} title="This phone plays the music">
      <i aria-hidden />
      Aux
    </span>
  );
}

function StartKey({
  view,
  token,
  label,
  before,
}: {
  view: RoomView;
  token: string;
  label: string;
  /** Runs inside the click, before the request: the DJ's phone unlocks its sound here. */
  before?: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  return (
    <>
      <Key
        block
        disabled={starting}
        onClick={async () => {
          setStarting(true);
          setError('');
          await before?.();
          const result = await send(view.code, token, { type: 'start' });
          if (!result.ok) setError(result.error);
          setStarting(false);
        }}
      >
        {starting ? 'Picking songs…' : label}
      </Key>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Paused: everything stops, and whoever is ready presses Resume. */
function PausedView({ view, token }: { view: RoomView; token: string }) {
  const pause = view.pause!;
  const mine = view.players.find((p) => p.id === view.you!.id)?.name === pause.by;
  const { note, index } = useLinerNote(pause.at, pause.by);
  return (
    <div className={styles.paused} role="dialog" aria-modal aria-label="Game paused">
      <div className={styles.pauseBars} aria-hidden>
        <i />
        <i />
      </div>
      <h1 className={styles.headline}>Intermission</h1>
      <p className={styles.eyebrow}>{mine ? 'You paused the game' : `Paused by ${pause.by}`}</p>
      <p key={index} className={styles.linerNote}>
        {note}
      </p>
      <Key block onClick={() => void send(view.code, token, { type: 'resume' })}>
        Resume
      </Key>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LobbyView({
  view,
  token,
  director,
  onLeft,
}: {
  view: RoomView;
  token: string;
  director: Director;
  onLeft: () => void;
}) {
  const me = view.players.find((p) => p.id === view.you!.id);
  const leader = view.you!.leader;
  const dj = view.you!.dj;
  const aux = view.mode === 'aux';
  const djName = view.players.find((p) => p.dj)?.name ?? 'Someone';
  const others = view.players.filter((p) => p.id !== view.you!.id);

  let sub: string;
  if (aux && dj) {
    sub =
      view.players.length === 1
        ? 'The music plays from this phone. Plug in, turn it up, and get the others in.'
        : 'The music plays from this phone. Start it when everyone is in.';
  } else if (aux) {
    const starter = leader ? 'You start' : view.players[0]?.dj ? 'They start' : `${view.players[0]?.name} starts`;
    sub = `${djName} has the aux, so the music comes from their phone. ${starter} the game when everyone is in.`;
  } else if (leader) {
    sub = 'You were first in, so you run the game. Start it when everyone has joined.';
  } else {
    sub = `Watch the big screen. ${view.players[0]?.name ?? 'The host'} starts the game.`;
  }

  return (
    <section className={styles.centre} data-align={aux ? 'top' : undefined}>
      <h1 className={styles.headline}>
        {aux && dj ? (
          <>
            You are on <em>aux</em>, {me?.name}
          </>
        ) : (
          <>You are in, {me?.name}</>
        )}
      </h1>
      <p className={styles.sub}>{sub}</p>

      {aux && dj && <InviteTicket code={view.code} />}

      {leader && (
        <StartKey view={view} token={token} label="Start game" before={dj ? director.enableSound : undefined} />
      )}
      {aux && dj && director.needsClick && (
        <p className={styles.small}>Tap Start when you are ready. It also turns this phone&rsquo;s sound on.</p>
      )}

      <div className={styles.list}>
        {view.players.map((p, i) => (
          <PlayerChip
            key={p.id}
            rank={i + 1}
            name={p.name}
            me={p.id === view.you!.id}
            note={aux && p.dj ? 'On aux' : undefined}
          />
        ))}
      </div>

      {aux && dj && others.length > 0 && <PassAux view={view} token={token} others={others} />}

      <Key
        variant="quiet"
        onClick={async () => {
          await send(view.code, token, { type: 'leave' });
          onLeft();
        }}
      >
        Leave room
      </Key>
    </section>
  );
}

/** The room code, big enough to read from the back seat, and a way to text it. */
function InviteTicket({ code }: { code: string }) {
  const join = useJoinUrl(code);
  const [copied, setCopied] = useState(false);

  const share = async () => {
    if (!join) return;
    const text = `Join my Music Mania game. Room ${code}:`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Music Mania', text, url: join.url });
        return;
      } catch {
        // Dismissed, or the browser could not: fall through to the clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(join.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard either. The code is on the screen; read it out.
    }
  };

  return (
    <div className={styles.ticket} data-tone="year">
      <div className={styles.ticketCode} aria-label={`Room code ${code}`}>
        {[...code].map((letter, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 12, rotate: -6 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.12 * i, type: 'spring', stiffness: 380, damping: 22 }}
          >
            {letter}
          </motion.span>
        ))}
      </div>
      <p className={styles.ticketHint}>
        They open <strong>{join?.display ?? '…'}</strong> and type it, or you send them the link.
      </p>
      <Key variant="tone" block onClick={() => void share()}>
        {copied ? 'Link copied' : 'Send the link'}
      </Key>
    </div>
  );
}

/** Hand the cable to someone else. Folded away until it is wanted. */
function PassAux({
  view,
  token,
  others,
}: {
  view: RoomView;
  token: string;
  others: RoomView['players'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.passAux}>
      <button type="button" className={styles.disclosure} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Pass the aux</span>
        <i aria-hidden data-open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.passList}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <p className={styles.small}>Whoever has the cable. Their phone takes over the music.</p>
            <div className={styles.passRow}>
              {others.map((p) => (
                <Key
                  key={p.id}
                  variant="quiet"
                  onClick={() => {
                    setOpen(false);
                    void send(view.code, token, { type: 'pass-aux', playerId: p.id });
                  }}
                >
                  {p.name}
                </Key>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RoundHeading({ view, lead }: { view: RoomView; lead: string }) {
  const round = view.round!;
  return (
    <>
      {view.mode !== 'solo' && (
        <p className={styles.eyebrow}>
          Song {round.index + 1} of {round.total}
        </p>
      )}
      <h1 className={styles.headline}>
        {lead} <em>{KINDS[round.kind].noun}</em>
      </h1>
    </>
  );
}

function LoadingView({ view, token, stalled }: { view: RoomView; token: string; stalled: boolean }) {
  const round = view.round!;
  const dj = view.you!.dj;
  const aux = view.mode === 'aux';
  const djName = view.players.find((p) => p.dj)?.name ?? 'Someone';

  const listen = view.mode === 'tv' ? 'Listen to the big screen.' : dj ? 'It plays from this phone.' : `Listen for ${djName}'s phone.`;

  if (round.kindChanged && !stalled) {
    return (
      <section className={styles.announce}>
        <p className={styles.announceEyebrow}>{round.index === 0 ? 'First up' : 'New question'}</p>
        <h1 className={styles.announceTitle}>
          Name the <em>{KINDS[round.kind].noun}</em>
        </h1>
        <p className={styles.announceHint}>{KINDS[round.kind].hint}</p>
      </section>
    );
  }
  return (
    <section className={styles.centre} data-align="top">
      <RoundHeading view={view} lead="Get ready to name the" />
      <p className={styles.sub}>{listen} You get one answer.</p>
      {aux && !dj && stalled && (
        <div className={styles.stall} role="status">
          <p>
            Still waiting on <strong>{djName}&rsquo;s</strong> phone to play the song. Is its screen on?
          </p>
          <Key variant="paper" onClick={() => void send(view.code, token, { type: 'pass-aux', playerId: view.you!.id })}>
            Take the aux
          </Key>
        </div>
      )}
    </section>
  );
}

function TimeBar({
  startedAt,
  clockOffset,
  frozenAt,
}: {
  startedAt: number;
  clockOffset: number;
  frozenAt?: number | null;
}) {
  const now = useServerNow(clockOffset, true, frozenAt);
  const left = Math.min(Math.max(1 - (now - startedAt) / GUESS_MS, 0), 1);
  return (
    <div className={styles.timeBar} role="timer" aria-label={`${Math.ceil(left * 15)} seconds left`}>
      <i style={{ transform: `scaleX(${left})` }} />
    </div>
  );
}

function GuessView({ view, token, clockOffset }: { view: RoomView; token: string; clockOffset: number }) {
  const round = view.round!;
  const info = KINDS[round.kind];
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const answer = view.you!.answer;

  useEffect(() => input.current?.focus(), []);

  const lockIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    const result = await send(view.code, token, { type: 'answer', text });
    setSending(false);
    if (!result.ok) setError(result.error);
  };

  const waitingOn = view.players.filter((p) => !p.answered).length;

  return (
    <section className={styles.centre} data-align="top">
      <RoundHeading view={view} lead="Name the" />
      {round.guessStartedAt !== null && (
        <TimeBar startedAt={round.guessStartedAt} clockOffset={clockOffset} frozenAt={view.pause?.at} />
      )}

      {answer ? (
        <TitleStrip
          className={styles.receipt}
          tone={round.kind}
          top={answer.gaveUp ? 'You gave up' : answer.text}
          label={`${answer.gaveUp ? 'Tapped out' : 'Locked in'} at ${(answer.elapsedMs / 1000).toFixed(1)} s`}
          bottom={waitingOn === 0 ? 'Everyone is in' : `Waiting for ${waitingOn} more`}
        />
      ) : (
        <form className={styles.answerForm} onSubmit={lockIn}>
          <Field
            ref={input}
            value={text}
            onChange={(e) =>
              setText(
                info.numeric
                  ? e.target.value.replace(/\D/g, '').slice(0, 4)
                  : e.target.value.slice(0, MAX_ANSWER_LENGTH),
              )
            }
            placeholder={info.placeholder}
            aria-label={info.placeholder}
            inputMode={info.numeric ? 'numeric' : 'text'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="send"
          />
          <Key
            type="submit"
            variant="tone"
            block
            disabled={sending || (info.numeric ? text.length !== 4 : !text.trim())}
          >
            Lock it in
          </Key>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <Key
            variant="quiet"
            className={styles.giveUp}
            disabled={sending}
            onClick={() => void send(view.code, token, { type: 'give-up' })}
          >
            Give up
          </Key>
        </form>
      )}
    </section>
  );
}

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

function NextCountdown({
  startedAt,
  clockOffset,
  frozenAt,
}: {
  startedAt: number;
  clockOffset: number;
  frozenAt?: number | null;
}) {
  const now = useServerNow(clockOffset, true, frozenAt);
  return <>{Math.max(0, Math.ceil((startedAt + REVEAL_MS - now) / 1000))}</>;
}

function answerNote(answer: RevealedAnswer | undefined, kind: string): string {
  if (!answer) return 'No answer';
  if (answer.gaveUp) return 'Gave up';
  if (kind === 'year' && answer.yearsOff !== undefined && answer.yearsOff > 0) {
    return `${answer.text} · ${answer.yearsOff} ${answer.yearsOff === 1 ? 'year' : 'years'} off`;
  }
  return answer.text;
}

/**
 * The round's scoreboard, folded under one line. Open by default where there
 * is no big screen to look at; a tap away where there is.
 */
function Scoreboard({ view, fastest }: { view: RoomView; fastest?: string }) {
  const round = view.round!;
  const [open, setOpen] = useState(view.mode === 'aux');
  const ranked = rankPlayers(view.players);
  const answers = new Map((round.answers ?? []).map((a) => [a.playerId, a]));
  const standing = ranked.find((r) => r.player.id === view.you!.id);
  const leaderName = ranked[0]?.player.name;

  return (
    <div className={styles.board}>
      <button type="button" className={styles.disclosure} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          {standing && (
            <>
              You are <strong>{ordinal(standing.rank)}</strong> of {view.players.length}
              {standing.rank !== 1 && leaderName ? ` · ${leaderName} leads` : ''}
            </>
          )}
        </span>
        <i aria-hidden data-open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className={styles.boardBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className={styles.list}>
              {ranked.map(({ player, rank }) => {
                const answer = answers.get(player.id);
                return (
                  <motion.div key={player.id} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                    <PlayerChip
                      rank={rank}
                      name={player.name}
                      me={player.id === view.you!.id}
                      lit={Boolean(answer?.points)}
                      note={answerNote(answer, round.kind)}
                      badge={answer?.points ? `${fastest === player.id ? '★ ' : ''}+${answer.points}` : undefined}
                      value={player.score.toLocaleString('en-US')}
                    />
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RevealView({ view, token, clockOffset }: { view: RoomView; token: string; clockOffset: number }) {
  const round = view.round!;
  const song = round.song;
  if (!song) return null;

  const alone = view.players.length === 1;
  const mine = round.answers?.find((a) => a.playerId === view.you!.id);
  const fastest = (round.answers ?? [])
    .filter((a) => a.correct)
    .sort((a, b) => a.elapsedMs - b.elapsedMs)[0];

  let verdict = 'No answer this time';
  if (mine) {
    if (mine.gaveUp) verdict = 'You gave up';
    else if (mine.correct) {
      verdict = alone
        ? mine.elapsedMs < 3000
          ? 'Right, and quick'
          : 'Right'
        : fastest?.playerId === mine.playerId
          ? 'Right, and first'
          : 'Right';
    } else if (mine.points > 0) verdict = `${mine.yearsOff} ${mine.yearsOff === 1 ? 'year' : 'years'} off`;
    else verdict = 'Not this time';
  }

  return (
    <section className={styles.centre} data-align="middle">
      <div className={styles.verdict} data-won={Boolean(mine?.points)}>
        <strong>+{mine?.points ?? 0}</strong>
        <span>{verdict}</span>
      </div>

      {/* The thing everyone was asked for, big enough to read at arm's length. */}
      <div className={styles.answerHero}>
        <span>The {KINDS[round.kind].noun} was</span>
        <strong data-long={String(song[round.kind]).length > 16}>{song[round.kind]}</strong>
        {mine && !mine.gaveUp && !mine.correct && <small>You said {mine.text}</small>}
      </div>

      <div className={styles.answerCard}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote album art */}
        <img src={song.artworkUrl} alt={`${song.album} cover`} className={styles.art} />
        <TitleStrip
          tone={round.kind}
          top={song.title}
          bottom={song.artist}
          label={`${song.album} · ${song.year}`}
          asked={round.kind === 'title' ? 'top' : round.kind === 'artist' ? 'bottom' : undefined}
        />
      </div>

      {!alone && <Scoreboard view={view} fastest={fastest?.playerId} />}

      <Key
        variant="tone"
        block
        onClick={() => void send(view.code, token, { type: 'next', roundIndex: round.index })}
      >
        {round.index + 1 === round.total ? (alone ? 'See your score' : 'See final scores') : 'Next song'}
      </Key>
      {round.revealStartedAt !== null && (
        <p className={styles.small}>
          Moves on by itself in <NextCountdown startedAt={round.revealStartedAt} clockOffset={clockOffset} frozenAt={view.pause?.at} />
        </p>
      )}
    </section>
  );
}

function FinishedView({ view, token, director }: { view: RoomView; token: string; director: Director }) {
  if (view.mode === 'solo') return <SoloFinished view={view} token={token} director={director} />;
  const ranked = rankPlayers(view.players);
  const mine = ranked.find((r) => r.player.id === view.you!.id);
  const dj = view.you!.dj;
  return (
    <section className={styles.centre} data-tone="artist">
      {/* No TV to throw the paper on this phone's behalf. */}
      {view.mode === 'aux' && mine?.rank === 1 && <Confetti />}
      <p className={styles.eyebrow}>Final scores</p>
      <h1 className={styles.headline}>
        {mine?.rank === 1 ? (
          <>
            You are <em>number one</em>
          </>
        ) : (
          <>
            You finished <em>{ordinal(mine?.rank ?? 0)}</em>
          </>
        )}
      </h1>
      <div className={styles.list}>
        {ranked.map(({ player, rank }) => (
          <PlayerChip
            key={player.id}
            rank={rank}
            name={player.name}
            lit={rank === 1}
            me={player.id === view.you!.id}
            value={player.score.toLocaleString('en-US')}
          />
        ))}
      </div>
      {view.you!.leader ? (
        <StartKey view={view} token={token} label="Play again" before={dj ? director.enableSound : undefined} />
      ) : (
        <p className={styles.small}>{view.players[0]?.name ?? 'The host'} can start another game.</p>
      )}
    </section>
  );
}

/** A solo run is over: the score, what it is certified as, and whether it beat the last one. */
function SoloFinished({ view, token, director }: { view: RoomView; token: string; director: Director }) {
  const score = view.players[0]?.score ?? 0;
  const grade = gradeRun(score, view.round?.total);
  // This screen mounts once per run, so the best it reads is the one before this run.
  const [previous] = useState(() => soloBest.get()?.score ?? null);
  const record = previous === null || score > previous;
  useEffect(() => {
    if (record) soloBest.set(score);
  }, [record, score]);

  return (
    <section className={styles.centre} data-tone="album" data-align="middle">
      {record && previous !== null && <Confetti />}
      <p className={styles.eyebrow}>Final score</p>
      <h1 className={styles.headline}>
        <em>{score.toLocaleString('en-US')}</em>
      </h1>
      <TitleStrip
        className={styles.gradeStrip}
        tone="album"
        top={grade.name}
        label={record ? (previous === null ? 'Your first run' : 'New personal best') : `Best on this phone: ${previous?.toLocaleString('en-US')}`}
        bottom={grade.line}
      />
      <StartKey view={view} token={token} label="Play again" before={director.enableSound} />
      <p className={styles.small}>Ten new songs. Same you, but wiser.</p>
    </section>
  );
}
