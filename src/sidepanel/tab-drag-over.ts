import { useEffect, useState } from 'react';

type Listener = (id: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function setTabDragOverId(id: string | null): void {
  if (current === id) return;
  current = id;
  for (const listener of listeners) listener(id);
}

export function useTabDragOver(id: string): boolean {
  const [over, setOver] = useState(current === id);
  useEffect(() => {
    const listener = (next: string | null) => setOver(next === id);
    listeners.add(listener);
    setOver(current === id);
    return () => { listeners.delete(listener); };
  }, [id]);
  return over;
}
