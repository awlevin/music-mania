'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Field, Key, VinylRecord, Wordmark } from '@/components/ds';
import { createRoom } from '@/lib/client/api';
import { getJukebox } from '@/lib/client/jukebox';
import { heard, hostTokens, lastMode, lastName, seats } from '@/lib/client/storage';
import { MAX_NAME_LENGTH } from '@/lib/game/config';
import type { Mode, QuestionKind } from '@/lib/game/types';

import styles from './landing.module.css';

interface ModeCard {
  id: Mode;
  tone: QuestionKind;
  title: string;
  /** One line, always visible. */
  blurb: string;
  /** The rest, once the card is open. */
  detail: string;
  cta: string;
  busy: string;
}

const MODES: ModeCard[] = [
  {
    id: 'tv',
    tone: 'title',
    title: 'Living room',
    blurb: 'One big screen. Everyone on their phone.',
    detail: 'This screen plays the music and keeps score. Mirror it to the TV, then everyone scans the code.',
    cta: 'Host a game',
    busy: 'Opening a room…',
  },
  {
    id: 'aux',
    tone: 'year',
    title: 'Aux',
    blurb: 'No TV. One phone on the speakers.',
    detail: 'Whoever has the cable plays the music from this phone. Everyone else joins on theirs. Made for the car.',
    cta: 'Take the aux',
    busy: 'Opening a room…',
  },
  {
    id: 'solo',
    tone: 'album',
    title: 'Solo',
    blurb: 'Just you. Ten songs, five minutes.',
    detail: 'A quick run against the clock, no witnesses. Beat your best.',
    cta: 'Play solo',
    busy: 'Picking your ten…',
  },
];

const noStore = () => () => {};

/** The card this device most likely wants: what it chose last time, else the TV on a big screen and the aux on a phone. */
function likelyMode(): Mode {
  return lastMode.get() ?? (window.matchMedia('(max-width: 720px)').matches ? 'aux' : 'tv');
}

export function Landing() {
  const router = useRouter();
  const [chosen, setChosen] = useState<Mode | null>(null);
  // Null while the server renders: every card starts closed, then one opens on the client.
  const likely = useSyncExternalStore(noStore, likelyMode, () => null);
  const open = chosen ?? likely;
  const [name, setName] = useState(() => (typeof window === 'undefined' ? '' : lastName.get()));
  const [code, setCode] = useState('');
  const [opening, setOpening] = useState<Mode | null>(null);
  const [error, setError] = useState('');

  const start = async (mode: Mode) => {
    if (opening) return;
    if (mode !== 'tv' && !name.trim()) {
      setError('Tell the scoreboard who you are first.');
      return;
    }
    setOpening(mode);
    setError('');
    // This click is the one that lets this screen play sound later, even
    // when the game is started from another phone.
    void getJukebox().unlock().catch(() => {});
    const result = await createRoom(heard.get(), mode, name.trim());
    if (!result.ok) {
      setError(result.error);
      setOpening(null);
      return;
    }
    lastMode.set(mode);
    const room = result.data as { code: string; hostToken?: string; token?: string };
    if (mode === 'tv') {
      hostTokens.set(room.code, room.hostToken!);
      router.push(`/host/${room.code}`);
      return;
    }
    lastName.set(name.trim());
    seats.set(room.code, room.token!);
    router.push(`/play/${room.code}`);
  };

  const join = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === 4) router.push(`/play/${code}`);
  };

  return (
    <main className={styles.page}>
      <div className={styles.record} aria-hidden>
        <VinylRecord spinning>
          <span className={styles.recordMark}>?</span>
        </VinylRecord>
      </div>

      <div className={styles.content}>
        <h1 className={styles.mark}>
          <Wordmark />
        </h1>
        <p className={styles.pitch}>
          Hear the song. Race everyone to name it.
        </p>

        <section className={styles.actions}>
          <div className={styles.action}>
            <h2 id="ways">Start a game</h2>
            <div className={styles.modes} role="radiogroup" aria-labelledby="ways">
              {MODES.map((mode) => (
                <ModeRow
                  key={mode.id}
                  mode={mode}
                  open={open === mode.id}
                  onOpen={() => {
                    setChosen(mode.id);
                    setError('');
                  }}
                  name={name}
                  onName={setName}
                  onStart={() => void start(mode.id)}
                  opening={opening === mode.id}
                  disabled={opening !== null}
                  error={open === mode.id ? error : ''}
                />
              ))}
            </div>
          </div>

          <form className={styles.action} onSubmit={join} data-tone="artist">
            <h2>Joining someone&rsquo;s game?</h2>
            <div className={styles.joinRow}>
              <Field
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                placeholder="Room code"
                aria-label="Room code"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
              <Key type="submit" variant="tone" disabled={code.length !== 4}>
                Join
              </Key>
            </div>
            <p>Four letters, on the big screen or in the text they sent you.</p>
          </form>
        </section>
      </div>
    </main>
  );
}

interface ModeRowProps {
  mode: ModeCard;
  open: boolean;
  onOpen: () => void;
  name: string;
  onName: (name: string) => void;
  onStart: () => void;
  opening: boolean;
  disabled: boolean;
  error: string;
}

/** One way to play. Closed, it is a title and a line; open, it says the rest and offers the key. */
function ModeRow({ mode, open, onOpen, name, onName, onStart, opening, disabled, error }: ModeRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const wantsName = mode.id !== 'tv';

  // Opening a card that needs a name puts the cursor in it, but only after a
  // tap: on first paint the keyboard should stay down.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open && touched && wantsName && !name) input.current?.focus();
  }, [open, touched, wantsName, name]);

  return (
    <div className={styles.mode} data-tone={mode.tone} data-open={open}>
      <button
        type="button"
        role="radio"
        aria-checked={open}
        className={styles.modeHead}
        onClick={() => {
          setTouched(true);
          onOpen();
        }}
      >
        <span className={styles.modeMark} aria-hidden>
          {open && <motion.i layoutId="mode-mark" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
        </span>
        <span className={styles.modeText}>
          <strong>{mode.title}</strong>
          <span>{mode.blurb}</span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            className={styles.modeBody}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <form
              className={styles.modeForm}
              onSubmit={(e) => {
                e.preventDefault();
                onStart();
              }}
            >
              <p className={styles.modeDetail}>{mode.detail}</p>
              {wantsName && (
                <Field
                  ref={input}
                  value={name}
                  onChange={(e) => onName(e.target.value.slice(0, MAX_NAME_LENGTH))}
                  placeholder="Your name"
                  aria-label="Your name"
                  autoComplete="off"
                  autoCapitalize="words"
                  spellCheck={false}
                  enterKeyHint="go"
                />
              )}
              <Key type="submit" variant="tone" block disabled={disabled}>
                {opening ? mode.busy : mode.cta}
              </Key>
              <p role="alert" className={styles.modeNote} data-error={Boolean(error)}>
                {error ||
                  (mode.id === 'tv'
                    ? 'This screen makes the noise. Phones stay silent.'
                    : mode.id === 'aux'
                      ? 'Keep this phone awake and plugged in.'
                      : 'Faster answers score more. No pressure.')}
              </p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
