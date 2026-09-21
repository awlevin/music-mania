'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getJukebox, type Jukebox } from '@/lib/client/jukebox';
import { REVEAL_MS } from '@/lib/game/config';
import type { RoomView } from '@/lib/game/types';

/** Time on the "get ready" card before the music starts, so the room can read the question. */
const INTRO_MS = 3600;
/** Longer when the question changes kind: the announcement needs reading. */
const ANNOUNCE_MS = 6000;
/** The tonearm swings in over this long; the music starts as it lands. */
const NEEDLE_MS = 1100;

/** Seconds. The next song arrives quickly, because its clock is running. */
const FADE_IN = 1;
/** The song leaves over the end of the reveal, and is gone this long before the reveal is. */
const REVEAL_FADE = 4;
const REVEAL_FADE_GAP = 0.6;
/** When the host moves on before that fade has happened, the song leaves under the "get ready" card. */
const FADE_OUT = 2;
const LOBBY_FADE = 1.5;
const FINALE_CROSSFADE = 3;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What the director tells the room about the audio: it began, or it would not. */
export type AudioReport = { type: 'audio-started' | 'audio-failed'; roundIndex: number };

export interface Director {
  jukebox: Jukebox | null;
  /** True when the browser is holding the sound back until someone clicks. */
  needsClick: boolean;
  /** Call from a click handler. */
  enableSound: () => Promise<void>;
  /** True from the moment the tonearm starts down until the round is over. */
  needleDown: boolean;
}

/**
 * Keeps the jukebox in step with the room. Between songs it fades the old one
 * out while the next loads on the other deck, swings the needle in, and only
 * when sound is actually out tells the room the round has begun, so the 15
 * seconds start when the room can hear music.
 *
 * `report` is how it tells the room: the host screen posts to the server, a
 * solo game reduces in place. Null while this screen has no say in the room.
 */
export function useDirector(
  view: RoomView | null,
  clockOffset: number,
  lobbyMusic: boolean,
  report: ((action: AudioReport) => Promise<void>) | null,
): Director {
  const [jukebox] = useState(() => (typeof window === 'undefined' ? null : getJukebox()));
  /** Whether the browser currently lets this page make sound. */
  const [unlocked, setUnlocked] = useState(() => jukebox?.unlocked ?? false);
  /** The cue whose needle has started down. */
  const [dropped, setDropped] = useState('');
  /** What the jukebox was last pointed at, so each thing is cued once. */
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
  const revealStartedAt = view?.round?.revealStartedAt ?? null;
  const finaleUrls = view?.finaleUrls;
  const finaleKey = finaleUrls?.join('|') ?? '';
  const lobbyUrl = view?.lobbyUrl;
  const introMs = view?.round?.kindChanged ? ANNOUNCE_MS : INTRO_MS;
  const paused = Boolean(view?.pause);
  const roundKey = roundIndex !== undefined && previewUrl ? `${roundIndex}:${previewUrl}` : '';

  useEffect(() => {
    if (!jukebox || !unlocked) return;
    if (paused) jukebox.hold();
    else jukebox.release();
  }, [jukebox, unlocked, paused]);

  // The song plays on through the answer, then fades out over the last few
  // seconds of the reveal, or before the preview runs out on its own if that
  // comes first: a 30 s preview is nearly spent by the end of a full round.
  // A pause shifts revealStartedAt on resume, which re-arms this.
  useEffect(() => {
    if (!jukebox || !unlocked || paused || phase !== 'reveal' || revealStartedAt === null) return;
    const revealLeft = revealStartedAt + REVEAL_MS - (Date.now() + clockOffset);
    const songLeft = jukebox.remaining() * 1000;
    const fadeAfter = Math.min(revealLeft, songLeft) - (REVEAL_FADE + REVEAL_FADE_GAP) * 1000;
    const timer = setTimeout(() => void jukebox.fadeOut(REVEAL_FADE), Math.max(fadeAfter, 0));
    return () => clearTimeout(timer);
  }, [jukebox, unlocked, paused, phase, roundKey, revealStartedAt, clockOffset]);

  useEffect(() => {
    if (!jukebox || !report || phase === undefined || !unlocked) return;
    const stillCued = (key: string) => cued.current === key;

    if (phase === 'lobby') {
      // Background music while people join, quieter than the game itself.
      const key = lobbyMusic && lobbyUrl ? `lobby:${lobbyUrl}` : 'lobby:silent';
      if (stillCued(key)) return;
      cued.current = key;
      void (async () => {
        if (key === 'lobby:silent') return jukebox.fadeOut(0.8);
        try {
          await jukebox.cue(lobbyUrl!);
          if (stillCued(key)) await jukebox.start({ loop: true, volume: 0.45, fadeIn: LOBBY_FADE, fadeOutOld: LOBBY_FADE });
        } catch {
          // A silent lobby is still a lobby.
        }
      })();
      return;
    }

    if (phase === 'finished') {
      // The party songs, each fading into the next, the first one rising out
      // of the last question's song.
      const key = `finale:${finaleKey}`;
      if (stillCued(key)) return;
      cued.current = key;
      if (finaleUrls?.length) void jukebox.playlist(finaleUrls, 1, FINALE_CROSSFADE);
      else void jukebox.fadeOut(FADE_OUT);
      return;
    }

    if (!roundKey || roundIndex === undefined || !previewUrl) return;
    if (phase !== 'loading') jukebox.prefetch(finaleUrls?.[0] ?? nextPreviewUrl ?? previewUrl);
    if (stillCued(roundKey)) return;
    cued.current = roundKey;
    // Judged by the cue alone, not by effect cleanup: an unrelated re-render
    // must never strand a round that is halfway through loading.
    const current = () => stillCued(roundKey);

    (async () => {
      try {
        if (phase === 'loading') {
          // The old song leaves while the new one loads on the other deck.
          void jukebox.fadeOut(FADE_OUT);
          await Promise.all([jukebox.cue(previewUrl), wait(introMs - NEEDLE_MS)]);
          if (!current()) return;
          setDropped(roundKey);
          await wait(NEEDLE_MS);
          if (!current()) return;
          await jukebox.start({ fadeIn: FADE_IN });
          if (!current()) return;
          await report({ type: 'audio-started', roundIndex });
        } else {
          // The host page was reloaded mid-song: rejoin it where it should be.
          await jukebox.cue(previewUrl);
          if (!current()) return;
          const offset = guessStartedAt ? (Date.now() + clockOffset - guessStartedAt) / 1000 : 0;
          await jukebox.start({ offset: Math.max(offset, 0), fadeIn: FADE_IN });
        }
      } catch (error) {
        if (!current()) return;
        cued.current = '';
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setUnlocked(false);
        } else if (phase === 'loading') {
          await report({ type: 'audio-failed', roundIndex });
        }
      }
    })();
    // guessStartedAt, clockOffset, introMs and finaleUrls are read once, when the thing is cued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jukebox, report, phase, roundKey, nextPreviewUrl, finaleKey, lobbyUrl, lobbyMusic, unlocked]);

  return {
    jukebox,
    needsClick: phase !== undefined && !unlocked,
    enableSound,
    needleDown: !paused && (phase === 'guessing' || phase === 'reveal' || (phase === 'loading' && dropped === roundKey)),
  };
}
