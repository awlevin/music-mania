'use client';

import { useEffect, useRef, useState } from 'react';

import { ANSWER_GRACE_MS, GUESS_MS, REVEAL_MS } from '@/lib/game/config';
import type { RoomView } from '@/lib/game/types';

import { send } from './api';

export type RoomStatus = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'removed';

export interface RoomConnection {
  view: RoomView | null;
  status: RoomStatus;
  /** Add to Date.now() to get the server's clock. */
  clockOffset: number;
}

/** When the current phase must end, on the server's clock. */
function deadline(view: RoomView): number | null {
  const round = view.round;
  if (!round) return null;
  if (view.phase === 'guessing' && round.guessStartedAt !== null) {
    return round.guessStartedAt + GUESS_MS + ANSWER_GRACE_MS;
  }
  if (view.phase === 'reveal' && round.revealStartedAt !== null) {
    return round.revealStartedAt + REVEAL_MS;
  }
  return null;
}

/**
 * Subscribe to a room. The server owns no timers, so this hook also does the
 * screen's share of timekeeping: once a deadline has passed on the server's
 * clock, it sends `tick` until the room moves on. `tickDelayMs` staggers the
 * screens so the TV normally gets there first and the phones are the backup.
 */
export function useRoom(code: string, token: string | null, tickDelayMs: number): RoomConnection {
  const [view, setView] = useState<RoomView | null>(null);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [clockOffset, setClockOffset] = useState(0);
  const latest = useRef<{ view: RoomView | null; offset: number }>({ view: null, offset: 0 });

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const source = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent(token)}`);

    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as RoomView;
      const offset = next.serverNow - Date.now();
      // Keep the smallest-latency estimate we have seen: later is never earlier.
      const best =
        latest.current.view === null ? offset : Math.max(latest.current.offset, offset);
      latest.current = { view: next, offset: best };
      setClockOffset(best);
      setView(next);
      setStatus('live');
    };
    source.addEventListener('removed', () => {
      stopped = true;
      source.close();
      setStatus('removed');
    });
    source.onerror = () => {
      if (stopped) return;
      // CLOSED means the server refused us (room gone); otherwise the browser
      // is already retrying on its own.
      if (source.readyState === EventSource.CLOSED) setStatus('closed');
      else setStatus('reconnecting');
    };

    return () => {
      stopped = true;
      source.close();
    };
  }, [code, token]);

  useEffect(() => {
    if (!token) return;
    let lastTick = 0;
    const timer = setInterval(() => {
      const { view: current, offset } = latest.current;
      if (!current) return;
      const due = deadline(current);
      if (due === null) return;
      const now = Date.now() + offset;
      if (now < due + tickDelayMs || Date.now() - lastTick < 2000) return;
      lastTick = Date.now();
      void send(code, token, { type: 'tick' });
    }, 100);
    return () => clearInterval(timer);
  }, [code, token, tickDelayMs]);

  return { view, status, clockOffset };
}
