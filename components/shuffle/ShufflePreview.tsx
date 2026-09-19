'use client';

import { type CSSProperties, useCallback, useEffect, useState } from 'react';

import { Key, Wordmark } from '@/components/ds';
import type { DrawnRound, GameDraw } from '@/lib/catalog/preview';
import { KINDS } from '@/lib/game/kinds';
import type { QuestionKind, Song } from '@/lib/game/types';

import styles from './shuffle.module.css';

const KIND_LABEL: Record<QuestionKind, string> = {
  title: 'Title',
  artist: 'Artist',
  year: 'Year',
  album: 'Album',
};

/** Consecutive rounds that ask the same question, as the game announces them. */
function groupRounds(rounds: DrawnRound[]): { kind: QuestionKind; first: number; rounds: DrawnRound[] }[] {
  const groups: { kind: QuestionKind; first: number; rounds: DrawnRound[] }[] = [];
  rounds.forEach((round, i) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === round.kind) last.rounds.push(round);
    else groups.push({ kind: round.kind, first: i + 1, rounds: [round] });
  });
  return groups;
}

/** Apple serves any size on request; 600px is more sleeve than a card needs. */
function thumb(url: string): string {
  return url.replace(/\/\d+x\d+bb\./, '/240x240bb.');
}

/** How many songs share each value of `key`, ordered by `order` (a rank) or by count. */
function tally(songs: Song[], key: (s: Song) => string, order?: (label: string) => number): [string, number][] {
  const counts = new Map<string, number>();
  for (const s of songs) counts.set(key(s), (counts.get(key(s)) ?? 0) + 1);
  return [...counts].sort((a, b) =>
    order ? order(a[0]) - order(b[0]) : b[1] - a[1] || a[0].localeCompare(b[0]),
  );
}

const decade = (s: Song) => `${Math.floor(s.year / 10) * 10}s`;
/** "1960s" before "2000s". */
const byDecade = (label: string) => Number.parseInt(label, 10);

interface SongCardProps {
  song: Song;
  /** Round number, spare number, or a mark for the finale. */
  tab: string;
  asked?: QuestionKind;
  index: number;
}

function SongCard({ song, tab, asked, index }: SongCardProps) {
  const line = (kind: QuestionKind, text: string) => (
    <span className={styles.line} data-kind={kind} data-asked={asked === kind}>
      {text}
    </span>
  );
  return (
    <li className={styles.card} data-tone={asked} style={{ '--i': index } as CSSProperties}>
      <span className={styles.tab}>{tab}</span>
      {/* eslint-disable-next-line @next/next/no-img-element -- remote album art, sized by CSS */}
      <img className={styles.art} src={thumb(song.artworkUrl)} alt="" loading="lazy" />
      <span className={styles.body}>
        {line('title', song.title)}
        {line('artist', song.artist)}
        <span className={styles.small}>
          {line('album', song.album)}
          <span className={styles.dot} aria-hidden>
            ·
          </span>
          {line('year', String(song.year))}
        </span>
        <span className={styles.genre}>{song.genre}</span>
      </span>
    </li>
  );
}

export function ShufflePreview({ initial }: { initial: GameDraw }) {
  const [draw, setDraw] = useState(initial);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const shuffle = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/shuffle', { cache: 'no-store' });
      if (!res.ok) throw new Error(`The server said ${res.status}.`);
      setDraw((await res.json()) as GameDraw);
      setCount((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draw a game. Try again.');
    } finally {
      setBusy(false);
    }
  }, []);

  // Space or R draws again, so a run of shuffles needs no mouse.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.key === ' ' || event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void shuffle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shuffle]);

  const asked = draw.rounds.map((r) => r.song);
  const decades = tally(asked, decade, byDecade);
  const genres = tally(asked, (s) => s.genre);
  const [opener, ...encores] = draw.finales;

  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Wordmark href="/" className={styles.mark} />
      </header>

      <h1 className={styles.title}>Shuffle preview</h1>
      <p className={styles.lead}>
        Each draw is what pressing Start would have queued for a fresh room: ten questions, three
        spares, and the finale. No artist twice, and any song with an open report sits out.
      </p>

      <div className={styles.controls}>
        <Key onClick={() => void shuffle()} disabled={busy}>
          {busy ? 'Shuffling…' : 'Shuffle again'}
        </Key>
        <span className={styles.counter}>
          <strong>Draw {count}</strong>
          <small>
            Press <kbd>space</kbd> or <kbd>R</kbd>
          </small>
        </span>
        <p role="alert" className={styles.error} data-error={Boolean(error)}>
          {error}
        </p>
      </div>

      <div className={styles.spread} aria-label="This draw at a glance">
        <span className={styles.spreadLabel}>Decades</span>
        <span className={styles.tally}>
          {decades.map(([d, n]) => (
            <span key={d}>
              {d.slice(2)} <b>×{n}</b>
            </span>
          ))}
        </span>
        <span className={styles.spreadLabel}>Genres</span>
        <span className={styles.tally}>
          {genres.map(([g, n]) => (
            <span key={g}>
              {g} <b>×{n}</b>
            </span>
          ))}
        </span>
      </div>

      <div key={draw.drawnAt} className={styles.draw} data-busy={busy}>
        {groupRounds(draw.rounds).map((group) => (
          <section key={group.first} className={styles.group} data-tone={group.kind}>
            <h2 className={styles.groupTitle}>
              <span className={styles.groupKind}>{KIND_LABEL[group.kind]}</span>
              <span className={styles.groupRange}>
                {group.rounds.length === 1
                  ? `Round ${group.first}`
                  : `Rounds ${group.first}–${group.first + group.rounds.length - 1}`}
                {' · '}Name the {KINDS[group.kind].noun}
              </span>
            </h2>
            <ol className={styles.cards}>
              {group.rounds.map((round, i) => (
                <SongCard
                  key={round.song.id}
                  song={round.song}
                  tab={String(group.first + i)}
                  asked={round.kind}
                  index={group.first + i - 1}
                />
              ))}
            </ol>
          </section>
        ))}

        <section className={styles.group}>
          <h2 className={styles.groupTitle}>
            <span className={styles.groupKind}>Spares</span>
            <span className={styles.groupRange}>Swapped in, in this order, if a preview refuses to play</span>
          </h2>
          <ol className={styles.cards}>
            {draw.spares.map((song, i) => (
              <SongCard key={song.id} song={song} tab={`S${i + 1}`} index={draw.rounds.length + i} />
            ))}
          </ol>
        </section>

        {opener && (
          <section className={styles.group}>
            <h2 className={styles.groupTitle}>
              <span className={styles.groupKind}>Finale</span>
              <span className={styles.groupRange}>Plays over the final scores</span>
            </h2>
            <ol className={styles.cards}>
              <SongCard song={opener} tab="♪" index={draw.rounds.length + draw.spares.length} />
            </ol>
            {encores.length > 0 && (
              <p className={styles.encores}>
                Then, if the scores stay up: {encores.map((s) => s.title).join(', ')}.
              </p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
