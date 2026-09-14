import { describe, expect, test } from 'vitest';
import { bookmarkUndoToastKey } from './bookmark-toasts';

describe('bookmarkUndoToastKey', () => {
  test('offers undo after a tree reorder', () => {
    expect(bookmarkUndoToastKey('MOVE_BOOKMARK')).toBe('bookmarkMoved');
    expect(bookmarkUndoToastKey('OPEN_BOOKMARK_URLS')).toBeNull();
  });
});
