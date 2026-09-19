'use client';

import { useEffect, useRef } from 'react';

import type { Jukebox } from '@/lib/client/jukebox';

const BARS = 72;

/** The music, drawn as rays leaving the edge of the record. */
export function Halo({ jukebox, active }: { jukebox: Jukebox | null; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !active) return;

    const tone = getComputedStyle(canvas).getPropertyValue('--tone').trim() || '#e9383f';
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const draw = () => {
      const size = canvas.clientWidth * window.devicePixelRatio;
      if (canvas.width !== size) canvas.width = canvas.height = size;
      ctx.clearRect(0, 0, size, size);

      const spectrum = jukebox?.readSpectrum();
      const centre = size / 2;
      // The canvas overhangs the record by 19% a side; rays start just outside the timer ring.
      const inner = size * 0.404;
      const reach = size * 0.092;
      ctx.strokeStyle = tone;
      ctx.lineCap = 'round';
      ctx.lineWidth = size * 0.009;

      for (let i = 0; i < BARS; i++) {
        // Mirror the spectrum so the loud bass sits at the top on both sides.
        const half = i < BARS / 2 ? i : BARS - 1 - i;
        const level = spectrum ? spectrum[2 + half * 2] / 255 : 0;
        const length = reach * (0.06 + Math.pow(level, 1.6));
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        ctx.globalAlpha = 0.35 + level * 0.65;
        ctx.beginPath();
        ctx.moveTo(centre + Math.cos(angle) * inner, centre + Math.sin(angle) * inner);
        ctx.lineTo(
          centre + Math.cos(angle) * (inner + length),
          centre + Math.sin(angle) * (inner + length),
        );
        ctx.stroke();
      }
      if (!still) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [jukebox, active]);

  return <canvas ref={ref} aria-hidden />;
}
