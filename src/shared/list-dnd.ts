export type ListPlaceholderDest<Id extends string | number> =
  | { type: 'origin' }
  | { type: 'end' }
  | { type: 'before'; id: Id }
  | { type: 'after'; id: Id }
  | { type: 'after-header'; id: Id };

export function dragAutoScrollDelta(
  clientY: number,
  scrollerTop: number,
  scrollerBottom: number,
  edge = 36,
  step = 16,
): number {
  if (clientY < scrollerTop + edge) return -step;
  if (clientY > scrollerBottom - edge) return step;
  return 0;
}

export function placeListPlaceholder<T, Id extends string | number>(
  rows: readonly T[],
  input: {
    dest: ListPlaceholderDest<Id>;
    isPlaceholder: (row: T) => boolean;
    isDragged: (row: T) => boolean;
    itemId: (row: T) => Id | undefined;
    headerId?: (row: T) => Id | undefined;
    placeholder: T;
  },
): T[] {
  const from = rows.findIndex((row) => !input.isPlaceholder(row) && input.isDragged(row));
  const base = rows.filter((row) => !input.isPlaceholder(row) && !input.isDragged(row));
  const next = [...base];
  if (input.dest.type === 'end') return [...next, input.placeholder];
  if (input.dest.type === 'origin') {
    const insertAt = from < 0
      ? next.length
      : rows.slice(0, from).filter((row) => !input.isPlaceholder(row) && !input.isDragged(row)).length;
    next.splice(insertAt, 0, input.placeholder);
    return next;
  }
  if (input.dest.type === 'after-header') {
    const headerId = input.dest.id;
    const over = next.findIndex((row) => input.headerId?.(row) === headerId);
    next.splice(over < 0 ? next.length : over + 1, 0, input.placeholder);
    return next;
  }
  const itemId = input.dest.id;
  const over = next.findIndex((row) => input.itemId(row) === itemId);
  if (over < 0) return [...next, input.placeholder];
  next.splice(over + (input.dest.type === 'after' ? 1 : 0), 0, input.placeholder);
  return next;
}
