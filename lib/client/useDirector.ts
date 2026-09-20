'use client';

// Keeps whichever device plays the music in step with the room: the TV in a
// living-room game, the DJ's phone in an aux or solo game.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { send } from '@/lib/client/api';
import { getJukebox, type Jukebox } from '@/lib/client/jukebox';
import type { RoomView } from '@/lib/game/types';

import { useNowPlaying } from './useNowPlaying';
import { useWakeLock } from './useWakeLock';

/** Time on the "get ready" card before the music starts, so the room can read the question. */
const INTRO_MS = 3600;
/** Longer when the question changes kind: the announcement needs reading. */
const ANNOUNCE_MS = 6000;
/** The tonearm swings in over this long; the music starts as it lands. */
const NEEDLE_MS = 1100;

/** Seconds. The last song leaves slowly; the next arrives quickly, because its clock is running. */
const FADE_OUT = 1.6;
const FADE_IN = 0.7;
const LOBBY_FADE = 1.5;
const FINALE_CROSSFADE = 3;

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
  /** True from the moment the tonearm starts down until the round is over. */
  needleDown: boolean;
}

/**
 * Keeps the jukebox in step with the room. Between songs it fades the old one
 * out while the next loads on the other deck, swings the needle in, and only
 * when sound is actually out tells the server the round has begun, so the 15
 * seconds start when the room can hear music.
 *
 * With a null `token` it does nothing at all: a phone that is not the DJ
 * never so much as creates an audio element.
 */
export function useDirector(
  code: string,
  token: string | null,
  view: RoomView | null,
  clockOffset: number,
  lobbyMusic: boolean,
): Director {
  // The jukebox exists only on a device that is allowed to play. A phone that
  // is handed the aux mid-game picks one up here, still locked: nobody has
  // clicked on it yet.
  const jukebox = useMemo<Jukebox | null>(
    () => (token && typeof window !== 'undefined' ? getJukebox() : null),
    [token],
  );
  // Whether the browser currently lets this page make sound. Read from the
  // jukebox on every render, because the answer changes underneath us: a
  // phone that becomes the DJ mid-game picks up a jukebox the landing page's
  // click may already have unlocked. `resound` is a render for its own sake,
  // after anything that changes the answer.
  const [, resound] = useState(0);
  const unlocked = Boolean(jukebox?.unlocked);
  /** The cue whose needle has started down. */
  const [dropped, setDropped] = useState('');
  /** What the jukebox was last pointed at, so each thing is cued once. */
  const cued = useRef('');

  useEffect(() => {
    if (!jukebox) return;
    return () => {
      jukebox.stop();
      cued.current = '';
    };
  }, [jukebox]);

  // A phone on the car stereo must not doze off between songs.
  useWakeLock(Boolean(token) && view !== null);
  // What the dashboard shows, and what the steering-wheel buttons do.
  useNowPlaying(token ? code : null, token, view);

  const enableSound = useCallback(async () => {
    if (!jukebox) return;
    await jukebox.unlock();
    resound((v) => v + 1);
  }, [jukebox]);

  const phase = view?.phase;
  const roundIndex = view?.round?.index;
  const previewUrl = view?.round?.previewUrl;
  const nextPreviewUrl = view?.round?.nextPreviewUrl;
  const guessStartedAt = view?.round?.guessStartedAt ?? null;
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

  useEffect(() => {
    if (!jukebox || !token || phase === undefined || !unlocked) return;
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
          await sendUntilHeard(code, token, { type: 'audio-started', roundIndex });
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
          // The browser took the permission back (a long silence, say): ask for a tap again.
          resound((v) => v + 1);
        } else if (phase === 'loading') {
          await sendUntilHeard(code, token, { type: 'audio-failed', roundIndex });
        }
      }
    })();
    // guessStartedAt, clockOffset, introMs and finaleUrls are read once, when the thing is cued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jukebox, token, code, phase, roundKey, nextPreviewUrl, finaleKey, lobbyUrl, lobbyMusic, unlocked]);

  return {
    jukebox,
    needsClick: Boolean(token) && phase !== undefined && !unlocked,
    enableSound,
    needleDown: !paused && (phase === 'guessing' || phase === 'reveal' || (phase === 'loading' && dropped === roundKey)),
  };
}
