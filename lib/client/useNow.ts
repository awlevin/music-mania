'use client';

import { useEffect, useState } from 'react';

/** The server's clock, re-read every animation frame while `active`. */
export function useServerNow(clockOffset: number, active: boolean): number {
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
  return now;
}
