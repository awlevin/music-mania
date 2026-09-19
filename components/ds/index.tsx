import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';

import type { QuestionKind } from '@/lib/game/types';

import styles from './ds.module.css';

export type Tone = QuestionKind;

// ---------------------------------------------------------------------------

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`${styles.wordmark} ${className}`} role="img" aria-label="Music Mania">
      <span aria-hidden>Music</span>
      <span aria-hidden>Mania</span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function lengthClass(text: string): 'short' | 'long' | 'longer' {
  if (text.length > 34) return 'longer';
  if (text.length > 20) return 'long';
  return 'short';
}

function Mystery() {
  return (
    <span className={styles.mystery} aria-label="Hidden">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} />
      ))}
    </span>
  );
}

interface TitleStripProps {
  /** Null draws the line as not yet known. */
  top: string | null;
  bottom: string | null;
  label: string;
  tone?: Tone;
  /** Which line the round asked for. */
  asked?: 'top' | 'bottom';
  className?: string;
}

/** The paper card a jukebox files a record under: title, band, artist. */
export function TitleStrip({ top, bottom, label, tone, asked, className = '' }: TitleStripProps) {
  const line = (text: string | null, which: 'top' | 'bottom') => (
    <div
      className={styles.stripLine}
      data-length={lengthClass(text ?? '')}
      data-asked={asked === which}
    >
      {text === null ? (
        <Mystery />
      ) : (
        <span key={text} className={styles.stripText}>
          {text}
        </span>
      )}
    </div>
  );
  return (
    <div className={`${styles.strip} ${className}`} data-tone={tone}>
      <div className={styles.stripFrame}>
        {line(top, 'top')}
        <div className={styles.stripBand}>
          <span className={styles.stripLabel}>{label}</span>
        </div>
        {line(bottom, 'bottom')}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface KeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'cherry' | 'tone' | 'paper' | 'quiet';
  block?: boolean;
}

/** A jukebox selector key: it travels when you press it. */
export function Key({ variant = 'cherry', block, className = '', ...rest }: KeyProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`${styles.key} ${className}`}
      data-variant={variant}
      data-block={block}
    />
  );
}

export function Field({
  className = '',
  ref,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input ref={ref} {...rest} className={`${styles.field} ${className}`} />;
}

// ---------------------------------------------------------------------------

interface PlayerChipProps {
  rank: ReactNode;
  name: string;
  value?: ReactNode;
  /** Small print under the name: what they answered, say. */
  note?: ReactNode;
  /** Sits before the value: points won this round. */
  badge?: ReactNode;
  /** Colours the rank tab with the round's tone. */
  lit?: boolean;
  me?: boolean;
  className?: string;
}

export function PlayerChip({ rank, name, value, note, badge, lit, me, className = '' }: PlayerChipProps) {
  return (
    <div className={`${styles.chip} ${className}`} data-lit={lit} data-me={me}>
      <span className={styles.chipRank}>{rank}</span>
      <span className={styles.chipBody}>
        <span className={styles.chipName}>{name}</span>
        {note != null && <span className={styles.chipNote}>{note}</span>}
      </span>
      <span className={styles.chipValue}>
        {badge != null && <span className={styles.chipBadge}>{badge}</span>}
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface RecordProps {
  spinning: boolean;
  /** Album art for the label. Without it the label shows `children`. */
  artworkUrl?: string;
  children?: ReactNode;
  className?: string;
}

export function VinylRecord({ spinning, artworkUrl, children, className = '' }: RecordProps) {
  return (
    <div className={`${styles.record} ${className}`} data-spinning={spinning}>
      <div className={styles.recordDisc}>
        <div className={styles.recordLabel}>
          {artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote album art, sized by CSS
            <img src={artworkUrl} alt="" />
          ) : (
            children
          )}
        </div>
        <div className={styles.recordHole} />
      </div>
    </div>
  );
}
