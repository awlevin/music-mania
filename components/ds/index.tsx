'use client';

import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, useEffect, useRef } from 'react';

import Link from 'next/link';

import type { QuestionKind } from '@/lib/game/types';

import styles from './ds.module.css';

export type Tone = QuestionKind;

// ---------------------------------------------------------------------------

interface WordmarkProps {
  className?: string;
  /** Where a click goes. Without it the wordmark is just lettering. */
  href?: string;
}

export function Wordmark({ className = '', href }: WordmarkProps) {
  const lettering = (
    <>
      <span aria-hidden>Music</span>
      <span aria-hidden>Mania</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} className={`${styles.wordmark} ${styles.wordmarkLink} ${className}`} aria-label="Music Mania home">
        {lettering}
      </Link>
    );
  }
  return (
    <span className={`${styles.wordmark} ${className}`} role="img" aria-label="Music Mania">
      {lettering}
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

/** How long a platter takes to reach speed, or coast to a stop. */
const SPIN_EASE_MS = 1400;

export function VinylRecord({ spinning, artworkUrl, children, className = '' }: RecordProps) {
  const disc = useRef<HTMLDivElement>(null);

  // A platter has weight: it winds up and coasts down. The CSS animation
  // always runs; this eases its playback rate between 0 and 1.
  useEffect(() => {
    const animation = disc.current?.getAnimations()[0];
    if (!animation) return;
    const target = spinning ? 1 : 0;
    const from = animation.playbackRate;
    if (from === target) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation.playbackRate = target;
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min((now - began) / SPIN_EASE_MS, 1);
      const eased = 1 - (1 - t) * (1 - t);
      animation.playbackRate = from + (target - from) * eased;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [spinning]);

  return (
    <div className={`${styles.record} ${className}`}>
      <div ref={disc} className={styles.recordDisc}>
        <div className={styles.recordLabel}>
          {children}
          {/* eslint-disable-next-line @next/next/no-img-element -- remote album art, sized by CSS */}
          {artworkUrl && <img src={artworkUrl} alt="" />}
        </div>
        <div className={styles.recordHole} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** An on/off setting: a labelled row with a jukebox toggle at the end. */
export function Switch({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.switchText}>
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <span className={styles.switchTrack} aria-hidden>
        <i />
      </span>
    </button>
  );
}

/** A round button that holds one icon. */
export function IconButton({
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} {...rest} className={`${styles.iconButton} ${className}`} />
  );
}

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden>
      <rect x="5" y="4" width="5" height="16" rx="1.5" />
      <rect x="14" y="4" width="5" height="16" rx="1.5" />
    </svg>
  );
}
