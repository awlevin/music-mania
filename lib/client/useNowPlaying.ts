'use client';

import { useEffect } from 'react';

import type { RoomView } from '@/lib/game/types';

import { send } from './api';

/**
 * What the phone tells the car. A head unit, a Bluetooth speaker with a
 * display, and the lock screen all show the media session's metadata, so it
 * must never carry the song's name. Instead it says which song of ten this
 * is, and the steering-wheel buttons pause, resume and skip the game itself.
 */
export function useNowPlaying(code: string | null, token: string | null, view: RoomView | null): void {
  const phase = view?.phase;
  const index = view?.round?.index;
  const total = view?.round?.total;
  const paused = Boolean(view?.pause);

  useEffect(() => {
    if (!code || !token || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const line =
      phase === 'lobby'
        ? 'Waiting for players'
        : phase === 'finished'
          ? 'Final scores'
          : index !== undefined
            ? `Song ${index + 1} of ${total}`
            : '';
    try {
      session.metadata = new MediaMetadata({ title: 'Music Mania', artist: line, album: 'Name that tune' });
      session.playbackState = paused ? 'paused' : 'playing';
    } catch {
      // Older browsers: no metadata, no harm.
    }
  }, [code, token, phase, index, total, paused]);

  useEffect(() => {
    if (!code || !token || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['pause', () => void send(code, token, { type: 'pause' })],
      ['play', () => void send(code, token, { type: 'resume' })],
      ['nexttrack', () => index !== undefined && void send(code, token, { type: 'next', roundIndex: index })],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every browser knows every action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {}
      }
    };
  }, [code, token, index]);
}
