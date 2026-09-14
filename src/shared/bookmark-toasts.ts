export function bookmarkUndoToastKey(type: string): 'bookmarkMoved' | null {
  return type === 'MOVE_BOOKMARK' ? 'bookmarkMoved' : null;
}
