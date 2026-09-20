'use client';

import { useEffect } from 'react';

/**
 * Keep the screen on while `active`. A phone that locks stops running the
 * page, and a DJ phone that stops running the page never cues the next song.
 * Browsers drop the lock whenever the tab is hidden, so it is asked for again
 * each time the tab comes back.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // Low battery, or a browser that says no. The game still works; the screen may sleep.
      }
    };
    void request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
