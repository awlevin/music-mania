'use client';

import { useEffect, useState } from 'react';

import { shuffledNotes } from './linerNotes';

const EVERY_MS = 6500;

/** One liner note at a time, a new one every few seconds, in an order set by when the pause began. */
export function useLinerNote(pausedAt: number, name: string): { note: string; index: number } {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => i + 1), EVERY_MS);
    return () => clearInterval(timer);
  }, []);
  const notes = shuffledNotes(pausedAt, name);
  return { note: notes[index % notes.length], index };
}
