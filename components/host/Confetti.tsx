'use client';

import { useEffect, useRef } from 'react';

const COLOURS = ['#e9383f', '#ffc845', '#6fd6bf', '#ff9cbd', '#fff3d6'];

/** One burst of paper for the winner. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    const pieces = Array.from({ length: 160 }, (_, i) => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.2,
      y: h * 0.45,
      vx: (Math.random() - 0.5) * w * 0.018,
      vy: -h * (0.012 + Math.random() * 0.02),
      size: w * (0.005 + Math.random() * 0.006),
      spin: Math.random() * Math.PI,
      spinSpeed: (Math.random() - 0.5) * 0.4,
      colour: COLOURS[i % COLOURS.length],
    }));

    let frame = 0;
    const gravity = h * 0.0005;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of pieces) {
        p.vy += gravity;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += p.spinSpeed;
        if (p.y < h + p.size) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.colour;
        ctx.fillRect(-p.size, -p.size / 2, p.size * 2, p.size * Math.abs(Math.cos(p.spin)));
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
