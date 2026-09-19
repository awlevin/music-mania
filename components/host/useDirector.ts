'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { send } from '@/lib/client/api';
import { Jukebox } from '@/lib/client/jukebox';
import type { RoomView } from '@/lib/game/types';

/** Time on the "get ready" card before the needle drops, so the room can read the question. */
export const INTRO_MS = 3200;

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
  const [jukebox] = useState(() => (typeof window === 'undefined' ? null : new Jukebox()));
  /** Whether the browser currently lets this page make sound. */
  const [unlocked, setUnlocked] = useState(false);
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

  useEffect(() => {
    if (!jukebox || !token || phase === undefined || !unlocked) return;

    if (phase === 'lobby' || phase === 'finished') {
      cued.current = '';
      void jukebox.fadeOut();
      return;
    }
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
          await Promise.all([jukebox.fadeOut().then(() => jukebox.load(previewUrl)), wait(INTRO_MS)]);
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
    // guessStartedAt and clockOffset only matter on the reload path, read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jukebox, token, code, phase, roundIndex, previewUrl, nextPreviewUrl, unlocked]);

  const inRound = phase === 'loading' || phase === 'guessing' || phase === 'reveal';
  return { jukebox, needsClick: inRound && !unlocked, enableSound };
}
