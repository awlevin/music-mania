'use client';

import { useEffect, useState } from 'react';

/**
 * The server's clock, re-read every animation frame while `active`. Pass
 * `frozenAt` while the game is paused and every countdown stands still there.
 */
export function useServerNow(clockOffset: number, active: boolean, frozenAt?: number | null): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const loop = () => {
      setNow(Date.now() + clockOffset);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [clockOffset, active]);
  return frozenAt ?? now;
}
