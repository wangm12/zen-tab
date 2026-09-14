import { useEffect, useRef } from 'react';
import { ATMOSPHERE_PITCH, selectAtmosphereCells, shouldAnimateAtmosphere } from '../shared/atmosphere';

export function AtmosphereCanvas({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pointer = { x: -999, y: -999 };
    let visible = true;
    let frame = 0;
    let lastPaint = 0;
    let cells = selectAtmosphereCells(1, 1, 3);
    let lastBudget = 0;
    let interval = 1000 / 60;

    const atmosphereCanAnimate = () => shouldAnimateAtmosphere({
      enabled,
      reducedMotion: media.matches,
      documentHidden: document.hidden,
      visible,
    });

    const onPointer = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
    };

    const paint = (time: number) => {
      const start = performance.now();
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const style = getComputedStyle(document.documentElement);
      const accent = style.getPropertyValue('--accent').trim() || 'oklch(84% 0.14 118)';
      const dark = style.getPropertyValue('color-scheme').includes('dark');
      const alpha = dark ? 0.14 : 0.22;
      context.clearRect(0, 0, width, height);
      const drift = time / 9000;
      for (const cell of cells) {
        const px = cell.x * ATMOSPHERE_PITCH + 3;
        const py = ((cell.y * ATMOSPHERE_PITCH + drift * ATMOSPHERE_PITCH * 8 + cell.phase * 20) % (height + ATMOSPHERE_PITCH));
        const dx = px - pointer.x;
        const dy = py - pointer.y;
        const pull = Math.max(0, 1 - Math.hypot(dx, dy) / 90);
        const size = 2 + pull * 1.4;
        context.fillStyle = accent;
        context.globalAlpha = alpha + pull * 0.08;
        context.fillRect(px - size / 2 + pull * dx * -0.04, py - size / 2 + pull * dy * -0.04, size, size);
      }
      context.globalAlpha = 1;
      const spent = performance.now() - start;
      lastBudget = lastBudget * 0.8 + spent * 0.2;
      interval = lastBudget > 8 ? 1000 / 30 : 1000 / 60;
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const columns = Math.max(1, Math.ceil(width / ATMOSPHERE_PITCH));
      const rows = Math.max(1, Math.ceil(height / ATMOSPHERE_PITCH));
      cells = selectAtmosphereCells(columns, rows, 3);
      if (enabled && !atmosphereCanAnimate()) paint(0);
    };

    const tick = (time: number) => {
      const animate = atmosphereCanAnimate();
      if (animate && time - lastPaint >= interval) {
        lastPaint = time;
        paint(time);
      }
      if (!animate && !enabled) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      frame = requestAnimationFrame(tick);
    };

    const syncLoop = () => {
      if (atmosphereCanAnimate()) {
        if (frame === 0) frame = requestAnimationFrame(tick);
        return;
      }
      cancelAnimationFrame(frame);
      frame = 0;
      if (enabled) paint(0);
    };

    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      syncLoop();
    });
    observer.observe(canvas);

    const onResize = () => resize();
    const onMediaOrVisibility = () => {
      resize();
      syncLoop();
    };

    resize();
    syncLoop();
    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onMediaOrVisibility);
    media.addEventListener('change', onMediaOrVisibility);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onMediaOrVisibility);
      media.removeEventListener('change', onMediaOrVisibility);
    };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="atmosphere-canvas" aria-hidden="true" />;
}
