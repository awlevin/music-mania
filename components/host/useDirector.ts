'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { send } from '@/lib/client/api';
import { getJukebox, type Jukebox } from '@/lib/client/jukebox';
import type { RoomView } from '@/lib/game/types';

/** Time on the "get ready" card before the needle drops, so the room can read the question. */
const INTRO_MS = 3200;
/** Longer when the question changes kind: the announcement needs reading. */
const ANNOUNCE_MS = 6000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The round cannot begin until this lands, so one dropped request must not stall the room. */
async function sendUntilHeard(code: string, token: string, action: { type: string; roundIndex: number }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if ((await send(code, token, action)).ok) return;
    await wait(400 * (attempt + 1));
  }
}

export interface Director {
  jukebox: Jukebox | null;
  /** True when the browser is holding the sound back until someone clicks. */
  needsClick: boolean;
  /** Call from a click handler. */
  enableSound: () => Promise<void>;
}

/**
 * Keeps the jukebox in step with the room. It loads each round's preview,
 * drops the needle after the intro, and only then tells the server the round
 * has begun, so the 15 seconds start when the room can actually hear music.
 */
export function useDirector(
  code: string,
  token: string | null,
  view: RoomView | null,
  clockOffset: number,
): Director {
  const [jukebox] = useState(() => (typeof window === 'undefined' ? null : getJukebox()));
  /** Whether the browser currently lets this page make sound. */
  const [unlocked, setUnlocked] = useState(() => jukebox?.unlocked ?? false);
  /** The round + URL the jukebox was last pointed at, so each is cued once. */
  const cued = useRef('');

  useEffect(() => () => jukebox?.stop(), [jukebox]);

  const enableSound = useCallback(async () => {
    if (!jukebox) return;
    await jukebox.unlock();
    setUnlocked(true);
  }, [jukebox]);

  const phase = view?.phase;
  const roundIndex = view?.round?.index;
  const previewUrl = view?.round?.previewUrl;
  const nextPreviewUrl = view?.round?.nextPreviewUrl;
  const guessStartedAt = view?.round?.guessStartedAt ?? null;
  const finaleUrl = view?.finaleUrl;
  const introMs = view?.round?.kindChanged ? ANNOUNCE_MS : INTRO_MS;

  useEffect(() => {
    if (!jukebox || !token || phase === undefined || !unlocked) return;

    if (phase === 'lobby') {
      cued.current = '';
      void jukebox.fadeOut();
      return;
    }
    if (phase === 'finished') {
      // The party song, looping under the final scores.
      const key = `finale:${finaleUrl ?? ''}`;
      if (cued.current === key) return;
      cued.current = key;
      void (async () => {
        await jukebox.fadeOut();
        if (!finaleUrl || cued.current !== key) return;
        try {
          await jukebox.load(finaleUrl);
          if (cued.current === key) await jukebox.play(0, true);
        } catch {
          // No finale is a quieter ending, not a broken one.
        }
      })();
      return;
    }
    if (finaleUrl) jukebox.prefetch(finaleUrl);
    if (roundIndex === undefined || !previewUrl) return;
    if (nextPreviewUrl && phase !== 'loading') jukebox.prefetch(nextPreviewUrl);

    const key = `${roundIndex}:${previewUrl}`;
    if (cued.current === key) return;
    cued.current = key;

    // Judged by the cue alone, not by effect cleanup: an unrelated re-render
    // must never strand a round that is halfway through loading.
    const stillCurrent = () => cued.current === key;

    (async () => {
      try {
        if (phase === 'loading') {
          await Promise.all([jukebox.fadeOut().then(() => jukebox.load(previewUrl)), wait(introMs)]);
          if (!stillCurrent()) return;
          await jukebox.play();
          if (!stillCurrent()) return;
          await sendUntilHeard(code, token, { type: 'audio-started', roundIndex });
        } else {
          // The host page was reloaded mid-song: rejoin it where it should be.
          await jukebox.load(previewUrl);
          if (!stillCurrent()) return;
          const offset = guessStartedAt ? (Date.now() + clockOffset - guessStartedAt) / 1000 : 0;
          await jukebox.play(Math.max(offset, 0));
        }
      } catch (error) {
        if (!stillCurrent()) return;
        cued.current = '';
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setUnlocked(false);
        } else if (phase === 'loading') {
          await sendUntilHeard(code, token, { type: 'audio-failed', roundIndex });
        }
      }
    })();
    // guessStartedAt, clockOffset and introMs are read once, when the round is cued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jukebox, token, code, phase, roundIndex, previewUrl, nextPreviewUrl, finaleUrl, unlocked]);

  return { jukebox, needsClick: phase !== undefined && !unlocked, enableSound };
}
