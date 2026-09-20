'use client';

import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  Field,
  IconButton,
  Key,
  KeyLink,
  PauseIcon,
  PlayerChip,
  TitleStrip,
  VinylRecord,
  Wordmark,
} from '@/components/ds';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { Confetti } from '@/components/host/Confetti';
import { Halo } from '@/components/host/Halo';
import { type AudioReport, type Director, useDirector } from '@/components/host/useDirector';
import { drawSolo } from '@/lib/client/api';
import { recordSoloGame, useSoloRecord } from '@/lib/client/soloBest';
import { heard, soloGame } from '@/lib/client/storage';
import { useLinerNote } from '@/lib/client/useLinerNote';
import { useLocalRoom } from '@/lib/client/useLocalRoom';
import { useServerNow } from '@/lib/client/useNow';
import { GUESS_MS, MAX_ANSWER_LENGTH, REVEAL_MS, ROUND_KINDS } from '@/lib/game/config';
import { KINDS } from '@/lib/game/kinds';
import type { Action, QuestionKind, ReduceResult, RevealedAnswer, RoomState, RoomView } from '@/lib/game/types';
import {
  createSoloRoom,
  type PersonalBest,
  SOLO_PLAYER_ID,
  SOLO_PLAYER_NAME,
  type SoloDraw,
  tierFor,
} from '@/lib/solo/local';

import styles from './solo.module.css';

type Dispatch = (action: Action) => ReduceResult;

const points = (n: number) => n.toLocaleString('en-US');

const noStore = () => () => {};

/** The room this tab was in the middle of, or a fresh one. */
function bootRoom(): RoomState {
  const saved = soloGame.get<RoomState>();
  // A game that was underway comes back; a finished or unstarted one does not.
  const underway = saved && saved.phase !== 'lobby' && saved.phase !== 'finished';
  return underway ? saved : createSoloRoom(Date.now(), heard.get());
}

/**
 * Quick play: one person, one screen. The screen plays the music and takes
 * the answer, and the game is reduced right here in the browser.
 */
export function SoloScreen() {
  // The room is built from what this browser remembers, so only on the client.
  const mounted = useSyncExternalStore(
    noStore,
    () => true,
    () => false,
  );
  if (!mounted) return <main className={styles.page} aria-busy />;
  return <SoloGame />;
}

function SoloGame() {
  const [initial] = useState(bootRoom);
  const { state, view, dispatch } = useLocalRoom(initial, SOLO_PLAYER_ID);
  const report = useCallback(
    async (action: AudioReport) => {
      dispatch(action);
    },
    [dispatch],
  );
  const director = useDirector(view, 0, false, report);

  const { best, last } = useSoloRecord();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState(false);

  useEffect(() => soloGame.set(state), [state]);

  // Remember every song this screen reveals, so later games skip it.
  const revealedSongId = view.round?.song?.id;
  useEffect(() => {
    if (revealedSongId) heard.add(revealedSongId);
  }, [revealedSongId]);

  // The score goes in the book once per finished game.
  const score = state.players[0]?.score ?? 0;
  const finished = state.phase === 'finished';
  const recorded = useRef<RoomState | null>(null);
  useEffect(() => {
    if (!finished || recorded.current === state) return;
    recorded.current = state;
    recordSoloGame(score, Date.now());
  }, [finished, state, score]);

  const start = async () => {
    setStarting(true);
    setError('');
    // This click is what lets the browser play sound for the rest of the game.
    await director.enableSound();
    const result = await drawSolo(state.playedSongIds, state.finales[0]?.id);
    if (!result.ok) {
      setError(result.error);
      setStarting(false);
      return;
    }
    const draw = result.data as unknown as SoloDraw;
    const started = dispatch({ type: 'start', songs: draw.songs, spares: draw.spares, finales: draw.finales });
    if (!started.ok) setError(started.error);
    setStarting(false);
  };

  const tone = view.round?.kind;
  const inRound = state.phase === 'loading' || state.phase === 'guessing' || state.phase === 'reveal';
  const announcing = state.phase === 'loading' && Boolean(view.round?.kindChanged);
  const clockRunning = !state.pause && (state.phase === 'guessing' || state.phase === 'reveal');
  const song = state.phase === 'reveal' ? view.round?.song : undefined;
  const mine = view.round?.answers?.find((a) => a.playerId === SOLO_PLAYER_ID);

  return (
    <main
      className={styles.page}
      data-tone={tone}
      data-phase={state.phase}
      // Any click on the screen is enough to let it play sound.
      onPointerDown={director.needsClick ? () => void director.enableSound() : undefined}
    >
      <header className={styles.top}>
        <Wordmark className={styles.mark} href="/" />
        <div className={styles.topEnd}>
          {state.phase !== 'lobby' && (
            <span className={styles.score} aria-label={`Your score: ${points(score)}`}>
              {points(score)}
            </span>
          )}
          {clockRunning && (
            <IconButton label="Pause the game" onClick={() => dispatch({ type: 'pause', by: SOLO_PLAYER_NAME })}>
              <PauseIcon />
            </IconButton>
          )}
        </div>
      </header>

      {state.phase === 'lobby' && <Start best={best} starting={starting} error={error} onStart={() => void start()} />}
      {inRound && (
        <Round view={view} director={director} dispatch={dispatch} onFeedback={() => setFeedback(true)} />
      )}
      {finished && (
        <Finished
          state={state}
          best={best}
          fresh={Boolean(last?.fresh)}
          starting={starting}
          error={error}
          onAgain={() => void start()}
        />
      )}

      <AnimatePresence>
        {announcing && view.round && <Chapter key={view.round.kind} kind={view.round.kind} />}
      </AnimatePresence>

      <AnimatePresence>
        {state.pause && (
          <Intermission key="pause" pausedAt={state.pause.at} onResume={() => dispatch({ type: 'resume' })} />
        )}
      </AnimatePresence>

      {director.needsClick && inRound && (
        <div className={styles.soundGate}>
          <h2>The sound is off</h2>
          <p>Browsers mute a page until someone taps it.</p>
          <Key onClick={() => void director.enableSound()}>Turn sound on</Key>
        </div>
      )}

      {feedback && (
        <FeedbackSheet
          songTitle={song?.title}
          solo={song && view.round ? { songId: song.id, questionKind: view.round.kind, answer: mine?.text } : undefined}
          onClose={() => setFeedback(false)}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------

function Start({
  best,
  starting,
  error,
  onStart,
}: {
  best: PersonalBest | null;
  starting: boolean;
  error: string;
  onStart: () => void;
}) {
  return (
    <section className={styles.start}>
      <div className={styles.startRecord} aria-hidden>
        <VinylRecord spinning>
          <span className={styles.labelMark}>?</span>
        </VinylRecord>
      </div>
      <div className={styles.startText}>
        <p className={styles.eyebrow}>Quick play</p>
        <h1 className={styles.headline}>
          Just you and the <em>jukebox</em>
        </h1>
        <p className={styles.sub}>
          Ten songs, fifteen seconds each, on this screen. Same rules as the party: the faster you
          name it, the more it pays.
        </p>
        <Key block onClick={onStart} disabled={starting}>
          {starting ? 'Picking songs…' : 'Play'}
        </Key>
        <p className={styles.error} role="alert">
          {error}
        </p>
        {best && (
          <p className={styles.best}>
            Your best is <strong>{points(best.score)}</strong>
            {best.games > 1 && ` over ${best.games} games`}
          </p>
        )}
        <KeyLink href="/" variant="quiet">
          Host a party game instead
        </KeyLink>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface ClockProps {
  /** Set while paused: the clock face stops here. */
  frozenAt?: number | null;
}

function Countdown({ endsAt, frozenAt }: ClockProps & { endsAt: number }) {
  const now = useServerNow(0, true, frozenAt);
  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
  return (
    <span className={styles.countdown} data-urgent={seconds <= 5}>
      {seconds}
    </span>
  );
}

function TimerRing({ startedAt, frozenAt }: ClockProps & { startedAt: number }) {
  const now = useServerNow(0, true, frozenAt);
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

function NextCountdown({ startedAt, frozenAt }: ClockProps & { startedAt: number }) {
  const now = useServerNow(0, true, frozenAt);
  return <>{Math.max(0, Math.ceil((startedAt + REVEAL_MS - now) / 1000))}</>;
}

function Round({
  view,
  director,
  dispatch,
  onFeedback,
}: {
  view: RoomView;
  director: Director;
  dispatch: Dispatch;
  onFeedback: () => void;
}) {
  const round = view.round!;
  const revealed = view.phase === 'reveal' && round.song !== undefined;
  const song = revealed ? round.song! : null;
  const frozenAt = view.pause?.at;
  const guessing = view.phase === 'guessing' && round.guessStartedAt !== null;

  return (
    <div className={styles.round}>
      <ol className={styles.pips} aria-label={`Song ${round.index + 1} of ${round.total}`}>
        {ROUND_KINDS.map((kind, i) => (
          <li
            key={i}
            data-tone={kind}
            data-state={i < round.index ? 'done' : i === round.index ? 'now' : 'next'}
          />
        ))}
      </ol>

      <div className={styles.turntable} data-revealed={revealed}>
        <div className={styles.halo}>
          <Halo jukebox={director.jukebox} active />
        </div>
        {guessing && <TimerRing startedAt={round.guessStartedAt!} frozenAt={frozenAt} />}
        <VinylRecord
          spinning={director.needleDown || Boolean(view.pause)}
          artworkUrl={song?.artworkUrl}
          className={styles.record}
        >
          <span className={styles.labelMark}>?</span>
        </VinylRecord>
        {guessing && (
          <div className={styles.clock}>
            <Countdown endsAt={round.guessStartedAt! + GUESS_MS} frozenAt={frozenAt} />
          </div>
        )}
      </div>

      <section className={styles.prompt}>
        <p className={styles.eyebrow}>
          Song {round.index + 1} of {round.total}
        </p>
        {song ? (
          <Reveal view={view} dispatch={dispatch} onFeedback={onFeedback} />
        ) : (
          <Ask key={round.index} view={view} director={director} dispatch={dispatch} />
        )}
      </section>
    </div>
  );
}

function Ask({ view, director, dispatch }: { view: RoomView; director: Director; dispatch: Dispatch }) {
  const round = view.round!;
  const info = KINDS[round.kind];
  const guessing = view.phase === 'guessing' && round.guessStartedAt !== null;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // The keyboard comes up the moment the music does.
  useEffect(() => {
    if (guessing) input.current?.focus();
  }, [guessing]);

  const lockIn = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    const result = dispatch({ type: 'answer', playerId: SOLO_PLAYER_ID, text });
    if (!result.ok) setError(result.error);
  };

  const giveUp = () => {
    const result = dispatch({ type: 'give-up', playerId: SOLO_PLAYER_ID });
    if (result.ok) director.jukebox?.womp();
  };

  return (
    <>
      <h1 className={styles.headline}>
        {guessing ? 'Name the ' : 'Get ready to name the '}
        <em>{info.noun}</em>
      </h1>
      {guessing ? (
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
          <Key type="submit" variant="tone" block disabled={info.numeric ? text.length !== 4 : !text.trim()}>
            Lock it in
          </Key>
          <p className={styles.error} role="alert">
            {error}
          </p>
          <Key variant="quiet" className={styles.giveUp} onClick={giveUp}>
            Give up
          </Key>
        </form>
      ) : (
        <p className={styles.sub}>{round.kindChanged ? info.hint : 'Listen. You get one answer.'}</p>
      )}
    </>
  );
}

function verdictFor(answer: RevealedAnswer | undefined): string {
  if (!answer) return 'Out of time';
  if (answer.gaveUp) return 'You gave up';
  if (answer.correct) return `Right, in ${(answer.elapsedMs / 1000).toFixed(1)} s`;
  if (answer.points > 0) return `${answer.yearsOff} ${answer.yearsOff === 1 ? 'year' : 'years'} off`;
  return 'Not this time';
}

function Reveal({ view, dispatch, onFeedback }: { view: RoomView; dispatch: Dispatch; onFeedback: () => void }) {
  const round = view.round!;
  const song = round.song!;
  const mine = round.answers?.find((a) => a.playerId === SOLO_PLAYER_ID);
  const last = round.index + 1 === round.total;

  return (
    <>
      <div className={styles.verdict} data-won={Boolean(mine?.points)}>
        <strong>+{mine?.points ?? 0}</strong>
        <span>{verdictFor(mine)}</span>
      </div>

      <div className={styles.answerHero}>
        <span>The {KINDS[round.kind].noun} was</span>
        <strong data-long={String(song[round.kind]).length > 16}>{song[round.kind]}</strong>
        {mine && !mine.gaveUp && !mine.correct && <small>You said {mine.text}</small>}
      </div>

      <TitleStrip
        className={styles.strip}
        tone={round.kind}
        top={song.title}
        bottom={song.artist}
        label={`${song.album} · ${song.year}`}
        asked={round.kind === 'title' ? 'top' : round.kind === 'artist' ? 'bottom' : undefined}
      />

      <Key variant="tone" block onClick={() => dispatch({ type: 'next', roundIndex: round.index })}>
        {last ? 'See your score' : 'Next song'}
      </Key>
      {round.revealStartedAt !== null && (
        <p className={styles.small}>
          Moves on by itself in <NextCountdown startedAt={round.revealStartedAt} frozenAt={view.pause?.at} />
        </p>
      )}
      <button type="button" className={styles.footLink} onClick={onFeedback}>
        Something off with this song?
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------

function Finished({
  state,
  best,
  fresh,
  starting,
  error,
  onAgain,
}: {
  state: RoomState;
  best: PersonalBest | null;
  fresh: boolean;
  starting: boolean;
  error: string;
  onAgain: () => void;
}) {
  const score = state.players[0]?.score ?? 0;
  const tier = tierFor(score);
  return (
    <div className={styles.finished}>
      {fresh && <Confetti />}
      <section className={styles.result}>
        <p className={styles.eyebrow}>Final score</p>
        <strong className={styles.finalScore}>{points(score)}</strong>
        <h1 className={styles.headline}>{tier.title}</h1>
        <p className={styles.sub}>{tier.line}</p>
        {best && (
          <p className={styles.best} data-fresh={fresh}>
            {!fresh ? (
              <>
                Your best is <strong>{points(best.score)}</strong>
              </>
            ) : best.games === 1 ? (
              'Your first game. That is the score to beat.'
            ) : (
              <strong>New personal best</strong>
            )}
          </p>
        )}
        <Key block onClick={onAgain} disabled={starting}>
          {starting ? 'Picking songs…' : 'Play again'}
        </Key>
        <p className={styles.error} role="alert">
          {error}
        </p>
        <KeyLink href="/" variant="quiet">
          Host a party game
        </KeyLink>
      </section>

      <section className={styles.recap}>
        <h2 className={styles.panelTitle}>The songs</h2>
        <ol className={styles.recapList}>
          {state.rounds.map((round, i) => {
            const answer = round.answers[SOLO_PLAYER_ID];
            const said = !answer ? 'no answer' : answer.gaveUp ? 'gave up' : `you said ${answer.text}`;
            return (
              <li key={i} data-tone={round.kind}>
                <PlayerChip
                  rank={i + 1}
                  name={round.song.title}
                  note={`${round.song.artist} · ${said}`}
                  badge={KINDS[round.kind].noun}
                  value={`+${answer?.points ?? 0}`}
                  lit={Boolean(answer?.points)}
                />
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

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

/** Paused: the needle sits in the run-out groove, and there is something to read. */
function Intermission({ pausedAt, onResume }: { pausedAt: number; onResume: () => void }) {
  const { note, index } = useLinerNote(pausedAt, SOLO_PLAYER_NAME);
  return (
    <motion.div
      className={styles.intermission}
      role="dialog"
      aria-modal
      aria-label="Game paused"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className={styles.pauseBars} aria-hidden>
        <i />
        <i />
      </div>
      <h1 className={styles.headline}>Intermission</h1>
      <p className={styles.eyebrow}>You paused the game</p>
      <p key={index} className={styles.linerNote}>
        {note}
      </p>
      <Key block onClick={onResume}>
        Resume
      </Key>
    </motion.div>
  );
}
