'use client';

import { useSyncExternalStore } from 'react';

import { type PersonalBest, recordGame } from '@/lib/solo/local';

// How a solo player has done, across every quick play on this browser.

export interface SoloRecord {
  best: PersonalBest | null;
  /** The last game put in the book, and whether it set the best. */
  last: { score: number; fresh: boolean } | null;
}

const KEY = 'mm:solo:best';
const EMPTY: SoloRecord = { best: null, last: null };

const listeners = new Set<() => void>();
let cached: SoloRecord | null = null;

function read(): SoloRecord {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(KEY);
    cached = { best: raw ? (JSON.parse(raw) as PersonalBest) : null, last: null };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

/** Put one finished game in the book. */
export function recordSoloGame(score: number, now: number): void {
  const { best } = read();
  const fresh = !best || score > best.score;
  cached = { best: recordGame(best, score, now), last: { score, fresh } };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cached.best));
  } catch {
    // Private mode: the record lasts until the tab closes.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function useSoloRecord(): SoloRecord {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
