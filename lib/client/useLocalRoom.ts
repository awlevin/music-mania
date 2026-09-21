'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { phaseDeadline } from '@/lib/game/deadline';
import { reduce } from '@/lib/game/reducer';
import type { Action, ReduceResult, RoomState, RoomView } from '@/lib/game/types';
import { viewFor } from '@/lib/game/views';

export interface LocalRoom {
  state: RoomState;
  /** The host's view of the room, with `you` filled in for the local player. */
  view: RoomView;
  /** Reduce one action on this browser's clock. Synchronous: the result is final. */
  dispatch: (action: Action) => ReduceResult;
}

interface Snapshot {
  state: RoomState;
  view: RoomView;
}

function snapshot(state: RoomState, playerId: string, now: number): Snapshot {
  const host = viewFor(state, { role: 'host' }, now);
  const player = viewFor(state, { role: 'player', playerId }, now);
  return { state, view: { ...host, you: player.you } };
}

/**
 * A room that lives in this tab: `reduce` runs here, on this clock, with no
 * server in the loop. The screen still keeps time the way every screen does,
 * by sending `tick` once a deadline has passed.
 */
export function useLocalRoom(initial: RoomState, playerId: string): LocalRoom {
  const [current, setCurrent] = useState(() => snapshot(initial, playerId, initial.createdAt));
  // Dispatches are synchronous and in order, so the ref is always the truth.
  const latest = useRef(current);

  const dispatch = useCallback(
    (action: Action): ReduceResult => {
      const now = Date.now();
      const result = reduce(latest.current.state, action, now);
      if (result.ok && result.state !== latest.current.state) {
        latest.current = snapshot(result.state, playerId, now);
        setCurrent(latest.current);
      }
      return result;
    },
    [playerId],
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const { state, view } = latest.current;
      if (state.pause) return;
      const due = phaseDeadline(view);
      if (due !== null && Date.now() >= due) dispatch({ type: 'tick' });
    }, 100);
    return () => clearInterval(timer);
  }, [dispatch]);

  return { state: current.state, view: current.view, dispatch };
}
