'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Field, IconButton, Key, PauseIcon, PlayerChip, TitleStrip, Wordmark } from '@/components/ds';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { send } from '@/lib/client/api';
import { lastName, seats } from '@/lib/client/storage';
import { useLinerNote } from '@/lib/client/useLinerNote';
import { useServerNow } from '@/lib/client/useNow';
import { useRoom } from '@/lib/client/useRoom';
import { GUESS_MS, MAX_ANSWER_LENGTH, MAX_NAME_LENGTH, REVEAL_MS } from '@/lib/game/config';
import { KINDS } from '@/lib/game/kinds';
import { rankPlayers } from '@/lib/game/rank';
import type { RoomView } from '@/lib/game/types';

import styles from './play.module.css';

const noStore = () => () => {};

/** Phones back the TV up as timekeepers, each a little later than the last. */
const tickDelay = 400 + Math.floor(Math.random() * 900);

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
}

function Shell({ code, children, tone, token, songTitle, onPause }: ShellProps) {
  const [feedback, setFeedback] = useState(false);
  return (
    <main className={styles.page} data-tone={tone}>
      <header className={styles.top}>
        <Wordmark className={styles.topMark} href="/" />
        <div className={styles.topEnd}>
          <span className={styles.topCode}>Room {code}</span>
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
  const [roomGone, setRoomGone] = useState(false);

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
  return (
    <Shell
      code={code}
      tone={view.round?.kind}
      token={token}
      songTitle={view.phase === 'reveal' ? view.round?.song?.title : undefined}
      onPause={
        !view.pause && (view.phase === 'guessing' || view.phase === 'reveal')
          ? () => void send(code, token, { type: 'pause' })
          : undefined
      }
    >
      {view.pause && <PausedView view={view} token={token} />}
      {me && view.phase !== 'lobby' && (
        <div className={styles.me}>
          <span>{me.name}</span>
          <strong>{me.score.toLocaleString('en-US')}</strong>
        </div>
      )}
      {view.phase === 'lobby' && <LobbyView view={view} token={token} onLeft={() => onSeatLost('')} />}
      {view.phase === 'loading' && <LoadingView view={view} />}
      {view.phase === 'guessing' && (
        <GuessView key={view.round!.index} view={view} token={token} clockOffset={clockOffset} />
      )}
      {view.phase === 'reveal' && <RevealView view={view} token={token} clockOffset={clockOffset} />}
      {view.phase === 'finished' && <FinishedView view={view} token={token} />}
      {status === 'reconnecting' && <div className={styles.toast}>Reconnecting…</div>}
    </Shell>
  );
}

function StartKey({ view, token, label }: { view: RoomView; token: string; label: string }) {
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

function LobbyView({ view, token, onLeft }: { view: RoomView; token: string; onLeft: () => void }) {
  const me = view.players.find((p) => p.id === view.you!.id);
  const leader = view.you!.leader;
  return (
    <section className={styles.centre}>
      <h1 className={styles.headline}>You are in, {me?.name}</h1>
      <p className={styles.sub}>
        {leader
          ? 'You were first in, so you run the game. Start it when everyone has joined.'
          : `Watch the big screen. ${view.players[0]?.name ?? 'The host'} starts the game.`}
      </p>
      {leader && <StartKey view={view} token={token} label="Start game" />}
      <div className={styles.list}>
        {view.players.map((p, i) => (
          <PlayerChip key={p.id} rank={i + 1} name={p.name} me={p.id === view.you!.id} />
        ))}
      </div>
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

function RoundHeading({ view, lead }: { view: RoomView; lead: string }) {
  const round = view.round!;
  return (
    <>
      <p className={styles.eyebrow}>
        Song {round.index + 1} of {round.total}
      </p>
      <h1 className={styles.headline}>
        {lead} <em>{KINDS[round.kind].noun}</em>
      </h1>
    </>
  );
}

function LoadingView({ view }: { view: RoomView }) {
  const round = view.round!;
  if (round.kindChanged) {
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
      <p className={styles.sub}>Listen to the big screen. You get one answer.</p>
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

function RevealView({ view, token, clockOffset }: { view: RoomView; token: string; clockOffset: number }) {
  const round = view.round!;
  const song = round.song;
  if (!song) return null;

  const mine = round.answers?.find((a) => a.playerId === view.you!.id);
  const fastest = (round.answers ?? [])
    .filter((a) => a.correct)
    .sort((a, b) => a.elapsedMs - b.elapsedMs)[0];
  const standing = rankPlayers(view.players).find((r) => r.player.id === view.you!.id);

  let verdict = 'No answer this time';
  if (mine) {
    if (mine.gaveUp) verdict = 'You gave up';
    else if (mine.correct) verdict = fastest?.playerId === mine.playerId ? 'Right, and first' : 'Right';
    else if (mine.points > 0) verdict = `${mine.yearsOff} ${mine.yearsOff === 1 ? 'year' : 'years'} off`;
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

      {standing && (
        <p className={styles.sub}>
          You are {ordinal(standing.rank)} of {view.players.length}
        </p>
      )}

      <Key
        variant="tone"
        block
        onClick={() => void send(view.code, token, { type: 'next', roundIndex: round.index })}
      >
        {round.index + 1 === round.total ? 'See final scores' : 'Next song'}
      </Key>
      {round.revealStartedAt !== null && (
        <p className={styles.small}>
          Moves on by itself in <NextCountdown startedAt={round.revealStartedAt} clockOffset={clockOffset} frozenAt={view.pause?.at} />
        </p>
      )}
    </section>
  );
}

function FinishedView({ view, token }: { view: RoomView; token: string }) {
  const ranked = rankPlayers(view.players);
  const mine = ranked.find((r) => r.player.id === view.you!.id);
  return (
    <section className={styles.centre} data-tone="artist">
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
        <StartKey view={view} token={token} label="Play again" />
      ) : (
        <p className={styles.small}>{view.players[0]?.name ?? 'The host'} can start another game.</p>
      )}
    </section>
  );
}
