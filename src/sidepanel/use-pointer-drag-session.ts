import { type PointerEvent as ReactPointerEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { dragAutoScrollDelta } from '../shared/list-dnd';
import { pointerDragDistance, shouldActivatePointerDrag } from '../shared/tab-dnd';

export function usePointerDragSession<T>(options: {
  enabled?: boolean;
  scrollerRef: RefObject<HTMLElement | null>;
  onActivate?: (source: T) => void;
  onDrag: (source: T, point: { x: number; y: number }) => void;
  onFinish: (source: T, canceled: boolean) => void;
}) {
  const [overlay, setOverlay] = useState<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<T | null>(null);
  const sessionRef = useRef<{
    source: T;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    capture: Element | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const detachRef = useRef<(() => void) | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const finish = useCallback((canceled: boolean) => {
    detachRef.current?.();
    detachRef.current = null;
    const session = sessionRef.current;
    sessionRef.current = null;
    setOverlay(null);
    if (session?.capture && 'hasPointerCapture' in session.capture && session.capture.hasPointerCapture(session.pointerId)) {
      try { session.capture.releasePointerCapture(session.pointerId); } catch { /* already released */ }
    }
    if (!session?.active) {
      setSource(null);
      return;
    }
    setSource(null);
    optionsRef.current.onFinish(session.source, canceled);
  }, []);

  useEffect(() => () => finish(true), [finish]);

  const onPointerDown = useCallback((next: T, event: ReactPointerEvent<HTMLElement>) => {
    if (optionsRef.current.enabled === false || event.button !== 0) return;
    event.stopPropagation();
    sessionRef.current = {
      source: next,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      capture: event.currentTarget,
    };

    const onMove = (move: PointerEvent) => {
      const session = sessionRef.current;
      if (!session || move.pointerId !== session.pointerId) return;
      if (!session.active) {
        if (!shouldActivatePointerDrag(pointerDragDistance(session.startX, session.startY, move.clientX, move.clientY))) {
          return;
        }
        session.active = true;
        suppressClickRef.current = true;
        const scroller = optionsRef.current.scrollerRef.current;
        const capture = scroller ?? session.capture;
        if (capture && 'setPointerCapture' in capture) {
          try { capture.setPointerCapture(session.pointerId); } catch { /* some targets reject capture */ }
        }
        session.capture = capture;
        setSource(session.source);
        optionsRef.current.onActivate?.(session.source);
      }
      move.preventDefault();
      setOverlay({ x: move.clientX, y: move.clientY });
      const scroller = optionsRef.current.scrollerRef.current;
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        scroller.scrollTop += dragAutoScrollDelta(move.clientY, rect.top, rect.bottom);
      }
      optionsRef.current.onDrag(session.source, { x: move.clientX, y: move.clientY });
    };
    const onUp = (up: PointerEvent) => {
      if (sessionRef.current?.pointerId !== up.pointerId) return;
      finish(false);
    };
    const onCancel = (up: PointerEvent) => {
      if (sessionRef.current?.pointerId !== up.pointerId) return;
      finish(true);
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape') return;
      finish(true);
    };
    const detach = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
    detachRef.current = detach;
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }, [finish]);

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  return { overlay, source, dragging: source != null, onPointerDown, consumeSuppressedClick };
}
