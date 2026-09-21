'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  ChevronIcon,
  DecadeIcon,
  GearIcon,
  IconButton,
  Key,
  PlayerChip,
  Switch,
  TitleStrip,
  VinylRecord,
  Wordmark,
} from '@/components/ds';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { send } from '@/lib/client/api';
import { useLinerNote } from '@/lib/client/useLinerNote';
import { updateSettings, useSettings } from '@/lib/client/settings';
import { heard, hostTokens } from '@/lib/client/storage';
import { useJoinUrl } from '@/lib/client/useJoinUrl';
import { useServerNow } from '@/lib/client/useNow';
import { useRoom } from '@/lib/client/useRoom';
import { GUESS_MS, REVEAL_MS, ROUND_KINDS } from '@/lib/game/config';
import {
  DECADES,
  DIFFICULTIES,
  DIFFICULTY_NAME,
  decadeName,
  describeDecades,
  presetDecades,
  presetOf,
  setupName,
  toggleDecade,
} from '@/lib/game/decades';
import { KINDS } from '@/lib/game/kinds';
import { rankPlayers } from '@/lib/game/rank';
import type { QuestionKind, RevealedAnswer, RoomView, Setup } from '@/lib/game/types';

import { Confetti } from './Confetti';
import { Halo } from './Halo';
import styles from './host.module.css';
import { QrCode } from './JoinCode';
import { type Director, useDirector } from './useDirector';
import { WhiteFlag } from './WhiteFlag';

const noStore = () => () => {};

export function HostScreen({ code }: { code: string }) {
  // undefined while the server renders; null when this browser holds no token.
  const token = useSyncExternalStore(
    noStore,
    () => hostTokens.get(code),
    () => undefined,
  );
  const { view, status, clockOffset } = useRoom(code, token ?? null, 0);
  const settings = useSettings();
  const director = useDirector(code, token ?? null, view, clockOffset, settings.lobbyMusic);

  // Remember every song this screen reveals, so later rooms skip it.
  const revealedSongId = view?.round?.song?.id;
  useEffect(() => {
    if (revealedSongId) heard.add(revealedSongId);
  }, [revealedSongId]);

  if (token === null || status === 'closed') {
    return (
      <main className={styles.stage}>
        <div className={styles.notice}>
          <Wordmark className={styles.noticeMark} />
          <h1>{token === null ? `This screen does not host room ${code}` : `Room ${code} has closed`}</h1>
          <p>
            {token === null
              ? 'A room belongs to the browser that opened it. Start a new one here.'
              : 'Rooms close after six quiet hours. Start a new one.'}
          </p>
          <Link href="/" className={styles.noticeLink}>
            Start a new game
          </Link>
        </div>
      </main>
    );
  }

  if (!view || !token) return <main className={styles.stage} aria-busy />;

  const tone = view.round?.kind;
  const announcing = view.phase === 'loading' && view.round?.kindChanged;
  return (
    <main
      className={styles.stage}
      data-tone={tone}
      data-phase={view.phase}
      // Any click on the TV is enough to let it play sound.
      onPointerDown={director.needsClick ? () => void director.enableSound() : undefined}
    >
      <Header view={view} />
      <AnimatePresence mode="wait">
        {view.phase === 'lobby' && (
          <Stage key="lobby">
            <Lobby view={view} token={token} director={director} />
          </Stage>
        )}
        {(view.phase === 'loading' || view.phase === 'guessing' || view.phase === 'reveal') && (
          <Stage key="game">
            <Game view={view} token={token} director={director} clockOffset={clockOffset} />
          </Stage>
        )}
        {view.phase === 'finished' && (
          <Stage key="finished">
            <Finished view={view} token={token} director={director} />
          </Stage>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {announcing && view.round && <Chapter key={view.round.kind} kind={view.round.kind} />}
      </AnimatePresence>

      <AnimatePresence>
        {view.pause && <Intermission key="pause" view={view} token={token} />}
      </AnimatePresence>

      {director.needsClick && view.phase !== 'lobby' && view.phase !== 'finished' && (
        <div className={styles.soundGate}>
          <h2>The sound is off</h2>
          <p>Browsers mute a page until someone clicks it.</p>
          <Key onClick={() => void director.enableSound()}>Turn sound on</Key>
        </div>
      )}
      {status === 'reconnecting' && <div className={styles.toast}>Reconnecting…</div>}
    </main>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className={styles.stageBody}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Paused: the stage dims, the needle sits in the run-out groove, and there is something to read. */
function Intermission({ view, token }: { view: RoomView; token: string }) {
  const pause = view.pause!;
  const { note, index } = useLinerNote(pause.at, pause.by);
  return (
    <motion.div
      className={styles.intermission}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className={styles.pauseBars} aria-hidden>
        <i />
        <i />
      </div>
      <h1>Intermission</h1>
      <p className={styles.pausedBy}>Paused by {pause.by}</p>
      <div className={styles.linerNote}>
        <AnimatePresence mode="wait">
          <motion.p
            key={index}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.45 }}
          >
            {note}
          </motion.p>
        </AnimatePresence>
      </div>
      <Key variant="paper" onClick={() => void send(view.code, token, { type: 'resume' })}>
        Resume
      </Key>
    </motion.div>
  );
}

/** Full-screen announcement when the question changes: "Now name the artist". */
function Chapter({ kind }: { kind: QuestionKind }) {
  const first = ROUND_KINDS.indexOf(kind) + 1;
  const last = ROUND_KINDS.lastIndexOf(kind) + 1;
  return (
    <motion.div
      className={styles.chapter}
      data-tone={kind}
      initial={{ clipPath: 'circle(0% at 50% 50%)' }}
      animate={{ clipPath: 'circle(75% at 50% 50%)' }}
      exit={{ clipPath: 'circle(0% at 50% 50%)' }}
      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <p className={styles.chapterEyebrow}>
        Songs {first} to {last}
      </p>
      <h1 className={styles.chapterTitle}>
        {first === 1 ? 'Name the' : 'Now name the'} <em>{KINDS[kind].noun}</em>
      </h1>
      <p className={styles.chapterHint}>{KINDS[kind].hint}</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function Header({ view }: { view: RoomView }) {
  const join = useJoinUrl(view.code);
  const inGame = view.phase !== 'lobby';
  return (
    <header className={styles.header}>
      <Wordmark className={styles.headerMark} href="/" />

      {inGame && view.round && (
        <ol className={styles.pips} aria-label={`Song ${view.round.index + 1} of ${view.round.total}`}>
          {ROUND_KINDS.map((kind, i) => (
            <li
              key={i}
              data-tone={kind}
              data-state={
                i < view.round!.index || view.phase === 'finished'
                  ? 'done'
                  : i === view.round!.index
                    ? 'now'
                    : 'next'
              }
            />
          ))}
        </ol>
      )}

      <div className={styles.headerEnd}>
        {inGame && join && (
          <div className={styles.joinTag}>
            <QrCode url={join.url} className={styles.joinTagQr} />
            <div>
              <span>Join at {join.display}</span>
              <strong>{view.code}</strong>
            </div>
          </div>
        )}
        {/* Not during play: nothing on the stage should invite a click mid-song. */}
        {(view.phase === 'lobby' || view.phase === 'finished') && (
          <SettingsMenu code={view.code} songTitle={view.round?.song?.title} />
        )}
      </div>
    </header>
  );
}

function SettingsMenu({ code, songTitle }: { code: string; songTitle?: string }) {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const token = useSyncExternalStore(
    noStore,
    () => hostTokens.get(code),
    () => null,
  );
  return (
    <div
      className={styles.settings}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <IconButton label="Settings" aria-expanded={open} onClick={() => setOpen(!open)}>
        <GearIcon />
      </IconButton>
      {open && (
        <div className={styles.settingsPanel} role="dialog" aria-label="Settings">
          <h2>Settings</h2>
          <Switch
            label="Lobby music"
            hint="Plays on this screen while people join."
            checked={settings.lobbyMusic}
            onChange={(lobbyMusic) => updateSettings({ lobbyMusic })}
          />
          <button
            type="button"
            className={styles.settingsLink}
            onClick={() => {
              setOpen(false);
              setFeedback(true);
            }}
          >
            Send feedback
          </button>
        </div>
      )}
      {feedback && (
        <FeedbackSheet code={code} token={token} songTitle={songTitle} onClose={() => setFeedback(false)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Lobby({ view, token, director }: { view: RoomView; token: string; director: Director }) {
  const join = useJoinUrl(view.code);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    setError('');
    // This click is what lets the browser play sound for the rest of the game.
    await director.enableSound();
    const result = await send(view.code, token, { type: 'start' });
    if (!result.ok) setError(result.error);
    setStarting(false);
  };

  return (
    <div className={styles.lobby}>
      <section className={styles.lobbyJoin}>
        <h1 className={styles.lobbyTitle}>Scan to play</h1>
        <div className={styles.ticket}>
          {join ? <QrCode url={join.url} className={styles.ticketQr} /> : <div className={styles.ticketQr} />}
          <div className={styles.ticketText}>
            <span>or open</span>
            <strong className={styles.ticketUrl}>{join?.display ?? '…'}</strong>
            <span>and enter</span>
            <strong className={styles.ticketCode}>{view.code}</strong>
          </div>
        </div>
        <p className={styles.lobbyHint}>
          The music plays from this screen. Phones stay silent: they are for answering.
        </p>
      </section>

      <section className={styles.lobbyRoom}>
        <h2 className={styles.panelTitle}>
          {view.players.length === 0 ? 'Waiting for players' : `In the room · ${view.players.length}`}
        </h2>
        <div className={styles.lobbyPlayers}>
          <AnimatePresence>
            {view.players.map((p, i) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.7, rotate: -4 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
              >
                <PlayerChip
                  rank={i + 1}
                  name={p.name}
                  value={
                    <button
                      className={styles.removeButton}
                      onClick={() => void send(view.code, token, { type: 'remove-player', playerId: p.id })}
                      aria-label={`Remove ${p.name}`}
                    >
                      ×
                    </button>
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
          {view.players.length === 0 && (
            <p className={styles.lobbyEmpty}>Names show up here as people join.</p>
          )}
        </div>

        <StartBar
          view={view}
          token={token}
          label={starting ? 'Picking songs…' : 'Start game'}
          disabled={view.players.length === 0 || starting}
          onStart={() => void start()}
          note={
            error ||
            (view.players[0]
              ? `${view.players[0].name} can also start it from their phone.`
              : '10 songs. 15 seconds each. Faster answers score more.')
          }
        />
        {director.needsClick && (
          <p className={styles.soundNote}>Click anywhere on this screen once, so it can play sound.</p>
        )}
      </section>
    </div>
  );
}

const PANEL_EASE = [0.2, 0.8, 0.2, 1] as const;

const PANEL = {
  closed: { opacity: 0, y: 10, scale: 0.97, transition: { duration: 0.16, ease: PANEL_EASE } },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.26, ease: PANEL_EASE, delayChildren: 0.05, staggerChildren: 0.07 },
  },
};

const PANEL_ROWS = {
  closed: { opacity: 0, y: 8 },
  open: { opacity: 1, y: 0, transition: { duration: 0.28, ease: PANEL_EASE } },
};

const LABEL_SWAP = {
  initial: { opacity: 0, y: '0.5em' },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: '-0.5em' },
  transition: { duration: 0.18 },
};

/**
 * The key that starts a game, and beside it what the game draws from. That
 * second key names the preset and nothing else; it opens a panel with Easy,
 * Medium and Hard above the decades they switch on. Any decade can then be
 * switched on or off by hand. The panel floats, so nothing on the stage moves.
 * The choice lives in the room, so a phone that starts the game gets the same
 * songs.
 */
function StartBar({
  view,
  token,
  label,
  disabled,
  onStart,
  note,
}: {
  view: RoomView;
  token: string;
  label: string;
  disabled: boolean;
  onStart: () => void;
  note: string;
}) {
  const [open, setOpen] = useState(false);
  // What this screen just asked for, shown until the room catches up.
  const [draft, setDraft] = useState<Setup | null>(null);
  const [error, setError] = useState('');
  // One request at a time, so quick taps reach the room in the order they were made.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const bar = useRef<HTMLDivElement>(null);
  const setup = draft ?? view.setup;

  // A press anywhere else puts the panel away.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  if (draft && draft.decades.join() === view.setup.decades.join()) setDraft(null);

  const apply = (next: Setup) => {
    if (next.decades.join() === setup.decades.join()) return;
    setError('');
    setDraft(next);
    queue.current = queue.current.then(async () => {
      const result = await send(view.code, token, { type: 'setup', ...next });
      if (!result.ok) {
        setError(result.error);
        setDraft(null);
      }
    });
  };

  const preset = presetOf(setup.decades);
  const name = setupName(setup.decades);
  const range = describeDecades(setup.decades);

  return (
    <div ref={bar} className={styles.startBar} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <div className={styles.lobbyStart}>
        <Key onClick={onStart} disabled={disabled}>
          {label}
        </Key>
        <Key
          variant="quiet"
          className={styles.setupKey}
          aria-expanded={open}
          aria-controls="game-setup"
          aria-label={`Difficulty: ${name}, ${range}`}
          onClick={() => setOpen(!open)}
        >
          <span className={styles.setupKeyText}>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.strong key={name} {...LABEL_SWAP}>
                {name}
              </motion.strong>
            </AnimatePresence>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span key={range} {...LABEL_SWAP}>
                {range}
              </motion.span>
            </AnimatePresence>
          </span>
          <ChevronIcon />
        </Key>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            id="game-setup"
            className={styles.setupPanel}
            role="group"
            aria-label="Difficulty and decades"
            initial="closed"
            animate="open"
            exit="closed"
            variants={PANEL}
          >
            <motion.div className={styles.presets} role="radiogroup" aria-label="Difficulty" variants={PANEL_ROWS}>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={d === preset}
                  onClick={() => apply({ decades: presetDecades(d) })}
                >
                  {DIFFICULTY_NAME[d]}
                </button>
              ))}
            </motion.div>
            <motion.div className={styles.decadeChips} role="group" aria-label="Decades" variants={PANEL_ROWS}>
              {DECADES.map((decade) => {
                const lit = setup.decades.includes(decade);
                return (
                  <button
                    key={decade}
                    type="button"
                    aria-pressed={lit}
                    // The last decade stays on: a game needs songs to draw from.
                    aria-disabled={lit && setup.decades.length === 1}
                    onClick={() => apply(toggleDecade(setup, decade))}
                  >
                    <DecadeIcon decade={decade} className={styles.decadeIcon} />
                    {decadeName(decade)}
                  </button>
                );
              })}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className={styles.startNote} role="alert">
        {error || note}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TimerProps {
  clockOffset: number;
  /** Set while paused: the clock face stops here. */
  frozenAt?: number | null;
}

function Countdown({ endsAt, clockOffset, frozenAt }: TimerProps & { endsAt: number }) {
  const now = useServerNow(clockOffset, true, frozenAt);
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <span className={styles.countdown} data-urgent={seconds <= 5}>
      {seconds}
    </span>
  );
}

function TimerRing({ startedAt, clockOffset, frozenAt }: TimerProps & { startedAt: number }) {
  const now = useServerNow(clockOffset, true, frozenAt);
  const progress = Math.min(Math.max((now - startedAt) / GUESS_MS, 0), 1);
  return (
    <svg className={styles.ring} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="48.5" className={styles.ringTrack} />
      <circle
        cx="50"
        cy="50"
        r="48.5"
        className={styles.ringFill}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={progress}
      />
    </svg>
  );
}

function RevealBar({ startedAt, clockOffset, frozenAt }: TimerProps & { startedAt: number }) {
  const now = useServerNow(clockOffset, true, frozenAt);
  const left = Math.max(0, startedAt + REVEAL_MS - now);
  return (
    <div className={styles.revealBar}>
      <span>Next song in {Math.ceil(left / 1000)}</span>
      <div>
        <i style={{ transform: `scaleX(${left / REVEAL_MS})` }} />
      </div>
    </div>
  );
}

const HEADING_FADE = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.28 },
};

function answerNote(answer: RevealedAnswer | undefined, kind: string): string {
  if (!answer) return 'No answer';
  if (answer.gaveUp) return 'Gave up';
  if (kind === 'year' && answer.yearsOff !== undefined && answer.yearsOff > 0) {
    return `${answer.text} · ${answer.yearsOff} ${answer.yearsOff === 1 ? 'year' : 'years'} off`;
  }
  return answer.text;
}

function Game({
  view,
  token,
  director,
  clockOffset,
}: {
  view: RoomView;
  token: string;
  director: Director;
  clockOffset: number;
}) {
  const round = view.round!;
  const info = KINDS[round.kind];
  const revealed = view.phase === 'reveal' && round.song !== undefined;
  const song = revealed ? round.song! : null;
  const answers = new Map((round.answers ?? []).map((a) => [a.playerId, a]));
  const ranked = rankPlayers(view.players);
  const lockedIn = view.players.filter((p) => p.answered).length;
  const fastest = (round.answers ?? [])
    .filter((a) => a.correct)
    .sort((a, b) => a.elapsedMs - b.elapsedMs)[0]?.playerId;
  // Year rounds can pay out with nobody exactly right: credit the best near miss.
  const closest = (round.answers ?? [])
    .filter((a) => a.points > 0)
    .sort((a, b) => b.points - a.points)[0]?.playerId;
  const winnerName = view.players.find((p) => p.id === (fastest ?? closest))?.name;

  return (
    <div className={styles.game}>
      <section className={styles.deck}>
        <div className={styles.prompt}>
          <AnimatePresence mode="wait" initial={false}>
          {revealed ? (
            <motion.h1 key={`reveal-${round.index}`} {...HEADING_FADE}>
              {winnerName ? (
                <>
                  <em>{winnerName}</em> {fastest ? 'got it first' : 'came closest'}
                </>
              ) : (
                'Nobody got it'
              )}
            </motion.h1>
          ) : (
            <motion.h1 key={`ask-${round.index}-${view.phase === 'loading'}`} {...HEADING_FADE}>
              {view.phase === 'loading' ? 'Get ready to name the ' : 'Name the '}
              <em>{info.noun}</em>
            </motion.h1>
          )}
          </AnimatePresence>
          {view.phase === 'guessing' && round.guessStartedAt !== null && (
            <Countdown endsAt={round.guessStartedAt + GUESS_MS} clockOffset={clockOffset} frozenAt={view.pause?.at} />
          )}
        </div>

        <div className={styles.turntableArea} data-revealed={revealed}>
          <div className={styles.sleeve}>
            {song && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- remote album art */}
                <img src={song.artworkUrl} alt={`${song.album} cover`} />
                <span className={styles.yearSticker} data-asked={round.kind === 'year'}>
                  {song.year}
                </span>
              </>
            )}
          </div>

          <div className={styles.turntable}>
            <div className={styles.halo}>
              <Halo jukebox={director.jukebox} active />
            </div>
            {view.phase === 'guessing' && round.guessStartedAt !== null && (
              <TimerRing startedAt={round.guessStartedAt} clockOffset={clockOffset} frozenAt={view.pause?.at} />
            )}
            <VinylRecord
              spinning={director.needleDown || Boolean(view.pause)}
              artworkUrl={song?.artworkUrl}
              className={styles.record}
            >
              <span className={styles.labelMark}>?</span>
            </VinylRecord>
            <div className={styles.tonearm} data-down={director.needleDown || Boolean(view.pause)} aria-hidden>
              <i />
            </div>
          </div>
        </div>

        <div className={styles.stripRow}>
          <TitleStrip
            className={styles.strip}
            tone={round.kind}
            top={song?.title ?? null}
            bottom={song?.artist ?? null}
            label={song ? 'Now playing' : `Song ${round.index + 1} of ${round.total}`}
            asked={!song ? undefined : round.kind === 'title' ? 'top' : round.kind === 'artist' ? 'bottom' : undefined}
          />
          {song && (
            <p className={styles.albumTag} data-asked={round.kind === 'album'}>
              <span>From the album</span>
              <strong>{song.album}</strong>
            </p>
          )}
        </div>
      </section>

      <aside className={styles.board}>
        <h2 className={styles.panelTitle}>
          {revealed ? 'This round' : `Locked in · ${lockedIn} of ${view.players.length}`}
        </h2>
        <div className={styles.boardList}>
          {ranked.map(({ player, rank }) => {
            const answer = answers.get(player.id);
            return (
              <motion.div key={player.id} layout transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
                <PlayerChip
                  rank={rank}
                  name={player.name}
                  lit={revealed ? Boolean(answer?.points) : player.answered && !player.gaveUp}
                  note={revealed ? answerNote(answer, round.kind) : player.gaveUp ? 'Gave up' : undefined}
                  badge={
                    revealed && answer?.points
                      ? `${fastest === player.id ? '★ ' : ''}+${answer.points}`
                      : undefined
                  }
                  value={player.score.toLocaleString('en-US')}
                />
              </motion.div>
            );
          })}
        </div>
        {revealed && (
          <div className={styles.boardFoot}>
            <Key
              variant="quiet"
              onClick={() => void send(view.code, token, { type: 'next', roundIndex: round.index })}
            >
              Next song
            </Key>
          </div>
        )}
      </aside>

      {/* Into the reveal too: the last player to give up ends the round at once. */}
      {(view.phase === 'guessing' || view.phase === 'reveal') &&
        view.players
          .filter((p) => p.gaveUp)
          .map((p, i) => (
            <WhiteFlag
              key={p.id}
              name={p.name}
              seed={`${p.id}:${round.index}`}
              slot={i}
              tone={round.kind}
              jukebox={director.jukebox}
            />
          ))}

      {revealed && round.revealStartedAt !== null && (
        <RevealBar startedAt={round.revealStartedAt} clockOffset={clockOffset} frozenAt={view.pause?.at} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Finished({ view, token, director }: { view: RoomView; token: string; director: Director }) {
  const ranked = rankPlayers(view.players);
  const winners = ranked.filter((r) => r.rank === 1).map((r) => r.player);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const again = async () => {
    setStarting(true);
    await director.enableSound();
    const result = await send(view.code, token, { type: 'start' });
    if (!result.ok) setError(result.error);
    setStarting(false);
  };

  return (
    <div className={styles.finished} data-tone="artist">
      <Confetti />
      <section className={styles.winner}>
        <h1>Top of the chart</h1>
        <TitleStrip
          className={styles.winnerStrip}
          tone="artist"
          top={winners.map((w) => w.name).join(' & ') || 'Nobody'}
          label={winners.length > 1 ? 'Tied at number one' : 'Number one'}
          bottom={`${(winners[0]?.score ?? 0).toLocaleString('en-US')} points`}
        />
        <StartBar
          view={view}
          token={token}
          label={starting ? 'Picking songs…' : 'Play again'}
          disabled={starting}
          onStart={() => void again()}
          note={error || 'Same room, ten new songs.'}
        />
      </section>
      <aside className={styles.board}>
        <h2 className={styles.panelTitle}>Final scores</h2>
        <div className={styles.boardList}>
          {ranked.map(({ player, rank }) => (
            <PlayerChip
              key={player.id}
              rank={rank}
              name={player.name}
              lit={rank === 1}
              value={player.score.toLocaleString('en-US')}
            />
          ))}
        </div>
      </aside>
    </div>
  );
}
