import { describe, expect, it } from 'vitest';
import { resolveTabMoveIndex, resolveUngroupedInsertIndex } from './tab-ops';
import { coerceTabDragHit, formatTabDragId, hitTestTabDragTarget, moveVisualTabRow, parseTabDragId, placeVisualPlaceholder, pointerDragDistance, rememberTabDragHit, resolveTabDragEnd, shouldActivatePointerDrag } from './tab-dnd';

const surfaces = [
  { kind: 'tab' as const, tabId: 12 },
  { kind: 'group' as const, groupId: 7 },
  { kind: 'ungrouped' as const, windowId: 3 },
  { kind: 'sticky-group' as const, groupId: 7 },
  { kind: 'sticky-ungrouped' as const, windowId: 3 },
  { kind: 'stash' as const },
  { kind: 'bookmark-nav' as const },
  { kind: 'bookmark-folder' as const, folderId: 'folder-9' },
  { kind: 'bookmark-inbox' as const },
  { kind: 'list-end' as const, windowId: 3 },
];

const tabs = [
  { tabId: 1, index: 0, groupId: 7, pinned: true },
  { tabId: 2, index: 1, groupId: 7, pinned: false },
  { tabId: 3, index: 2, groupId: 7, pinned: false },
  { tabId: 4, index: 3, groupId: -1, pinned: false },
  { tabId: 5, index: 4, groupId: -1, pinned: false },
];

function fakeDropNode(id: string, rect?: { top: number; height: number }): Element {
  const node = {
    getAttribute: (name: string) => name === 'data-tab-drop' ? id : null,
    getBoundingClientRect: () => ({ top: rect?.top ?? 0, height: rect?.height ?? 40, left: 0, width: 100, right: 100, bottom: (rect?.top ?? 0) + (rect?.height ?? 40), x: 0, y: rect?.top ?? 0, toJSON: () => ({}) }),
    closest: (selector: string) => selector === '[data-tab-drop]' ? node : null,
  };
  return node as unknown as Element;
}

describe('pointer drag activation', () => {
  it('activates after eight pixels and not before', () => {
    expect(shouldActivatePointerDrag(pointerDragDistance(10, 10, 14, 14))).toBe(false);
    expect(shouldActivatePointerDrag(pointerDragDistance(10, 10, 10, 18))).toBe(true);
  });
});

describe('hitTestTabDragTarget', () => {
  it('reads a tab surface and before/after from the pointer y', () => {
    const node = fakeDropNode('tab-5', { top: 100, height: 40 });
    expect(hitTestTabDragTarget(12, 110, () => node)).toEqual({
      surface: { kind: 'tab', tabId: 5 },
      placement: 'before',
    });
    expect(hitTestTabDragTarget(12, 130, () => node)).toEqual({
      surface: { kind: 'tab', tabId: 5 },
      placement: 'after',
    });
  });

  it('reads stash and group surfaces without placement', () => {
    expect(hitTestTabDragTarget(0, 0, () => fakeDropNode('nav-stash'))).toEqual({ surface: { kind: 'stash' } });
    expect(hitTestTabDragTarget(0, 0, () => fakeDropNode('group-7'))).toEqual({ surface: { kind: 'group', groupId: 7 } });
  });

  it('returns null when the point is not a drop surface', () => {
    expect(hitTestTabDragTarget(0, 0, () => null)).toBeNull();
    const orphan = { closest: () => null } as unknown as Element;
    expect(hitTestTabDragTarget(0, 0, () => orphan)).toBeNull();
  });

  it('reads the list-end surface', () => {
    expect(hitTestTabDragTarget(0, 0, () => fakeDropNode('list-end-3'))).toEqual({
      surface: { kind: 'list-end', windowId: 3 },
    });
  });
});

describe('coerceTabDragHit', () => {
  const bounds = { draggedTabId: 5, scrollerTop: 0, scrollerBottom: 400, windowId: 9 };

  it('keeps a real tab hit', () => {
    expect(coerceTabDragHit({ surface: { kind: 'tab', tabId: 2 }, placement: 'after' }, { ...bounds, clientY: 80, lastTabBottom: 200 })).toEqual({
      surface: { kind: 'tab', tabId: 2 },
      placement: 'after',
    });
  });

  it('turns a miss or self-hit below the last card into list-end', () => {
    expect(coerceTabDragHit(null, { ...bounds, clientY: 240, lastTabBottom: 200 })).toEqual({
      surface: { kind: 'list-end', windowId: 9 },
    });
    expect(coerceTabDragHit({ surface: { kind: 'tab', tabId: 5 }, placement: 'after' }, { ...bounds, clientY: 220, lastTabBottom: 200 })).toEqual({
      surface: { kind: 'list-end', windowId: 9 },
    });
  });

  it('does not invent a tail drop above the last card', () => {
    expect(coerceTabDragHit(null, { ...bounds, clientY: 40, lastTabBottom: 200 })).toBeNull();
  });
});

describe('rememberTabDragHit', () => {
  const previous = { surface: { kind: 'tab' as const, tabId: 2 }, placement: 'after' as const };
  type Hit = typeof previous | { surface: { kind: 'list-end'; windowId: number } };

  it('keeps the last real hit while the pointer stays over the list gap', () => {
    expect(rememberTabDragHit<Hit>(previous, null, true)).toEqual(previous);
    expect(rememberTabDragHit<Hit>(previous, { surface: { kind: 'list-end', windowId: 9 } }, true)).toEqual({
      surface: { kind: 'list-end', windowId: 9 },
    });
  });

  it('clears the hit after the pointer leaves the list', () => {
    expect(rememberTabDragHit(previous, null, false)).toBeNull();
  });
});

describe('tab drag ids', () => {
  it('round-trips every surface including sticky aliases', () => {
    for (const surface of surfaces) {
      expect(parseTabDragId(formatTabDragId(surface))).toEqual(surface);
    }
  });

  it('rejects unknown ids', () => {
    expect(parseTabDragId('window-1')).toBeNull();
    expect(parseTabDragId('tab-nope')).toBeNull();
  });

  it('does not parse bookmark row ids as folder headers', () => {
    expect(parseTabDragId('bookmark-folder-row-eng')).toBeNull();
    expect(parseTabDragId('bookmark-row-abc')).toBeNull();
    expect(parseTabDragId('bookmark-folder-eng')).toEqual({ kind: 'bookmark-folder', folderId: 'eng' });
  });
});

describe('resolveTabDragEnd', () => {
  const dragged = { tabId: 5, index: 4, pinned: false, groupId: -1 };
  const base = { dragged, windowId: 9, tabs };

  it('returns none when over is missing or the same tab', () => {
    expect(resolveTabDragEnd({ ...base, over: null })).toEqual({ type: 'none' });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'tab', tabId: 5 }, placement: 'before' })).toEqual({ type: 'none' });
  });

  it('moves before or after another tab with the same index math as resolveTabMoveIndex', () => {
    const options = { pinnedCount: 1, tabCount: 5, pinned: false };
    expect(resolveTabDragEnd({ ...base, over: { kind: 'tab', tabId: 2 }, placement: 'before' })).toEqual({
      type: 'move',
      tabId: 5,
      windowId: 9,
      index: resolveTabMoveIndex(4, { type: 'before', targetIndex: 1 }, options),
    });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'tab', tabId: 3 }, placement: 'after' })).toEqual({
      type: 'move',
      tabId: 5,
      windowId: 9,
      index: resolveTabMoveIndex(4, { type: 'after', targetIndex: 2 }, options),
    });
  });

  it('does not enter the pin zone', () => {
    const result = resolveTabDragEnd({ ...base, over: { kind: 'tab', tabId: 1 }, placement: 'before' });
    if (result.type === 'move') expect(result.index).toBeGreaterThanOrEqual(1);
    else expect(result).toEqual({ type: 'none' });
  });

  it('groups onto a real or sticky header unless already in that group', () => {
    expect(resolveTabDragEnd({ ...base, over: { kind: 'group', groupId: 7 } })).toEqual({ type: 'group', tabId: 5, groupId: 7 });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'sticky-group', groupId: 7 } })).toEqual({ type: 'group', tabId: 5, groupId: 7 });
    expect(resolveTabDragEnd({
      ...base,
      dragged: { tabId: 2, index: 1, pinned: false, groupId: 7 },
      over: { kind: 'group', groupId: 7 },
    })).toEqual({ type: 'none' });
  });

  it('ungroups and inserts at the ungrouped start', () => {
    const grouped = { tabId: 2, index: 1, pinned: false, groupId: 7 };
    const insert = resolveUngroupedInsertIndex(tabs);
    const index = resolveTabMoveIndex(1, { type: 'before', targetIndex: insert }, { pinnedCount: 1, tabCount: 5, pinned: false });
    expect(index).toEqual(2);
    expect(resolveTabDragEnd({ ...base, dragged: grouped, over: { kind: 'ungrouped', windowId: 9 } })).toEqual({
      type: 'ungroup-and-move',
      tabId: 2,
      windowId: 9,
      index,
    });
    expect(resolveTabDragEnd({ ...base, dragged: grouped, over: { kind: 'sticky-ungrouped', windowId: 9 } })).toEqual({
      type: 'ungroup-and-move',
      tabId: 2,
      windowId: 9,
      index,
    });
  });

  it('ungroups in place when the tab already sits at the ungrouped start', () => {
    expect(resolveTabDragEnd({
      ...base,
      dragged: { tabId: 3, index: 2, pinned: false, groupId: 7 },
      over: { kind: 'ungrouped', windowId: 9 },
    })).toEqual({ type: 'ungroup', tabId: 3 });
  });

  it('returns none when the tab is already the first ungrouped row', () => {
    expect(resolveTabDragEnd({
      ...base,
      dragged: { tabId: 4, index: 3, pinned: false, groupId: -1 },
      over: { kind: 'ungrouped', windowId: 9 },
    })).toEqual({ type: 'none' });
  });

  it('moves to the Chrome strip end on list-end', () => {
    expect(resolveTabDragEnd({
      dragged: { tabId: 2, index: 1, pinned: false, groupId: 7 },
      over: { kind: 'list-end', windowId: 9 },
      windowId: 9,
      tabs,
    })).toEqual({ type: 'move', tabId: 2, windowId: 9, index: -1 });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'list-end', windowId: 9 } })).toEqual({ type: 'none' });
  });

  it('splices a tab row before or after another tab', () => {
    const rows = [
      { kind: 'group' as const },
      { kind: 'tab' as const, tab: { tabId: 1 } },
      { kind: 'tab' as const, tab: { tabId: 2 } },
      { kind: 'tab' as const, tab: { tabId: 3 } },
    ];
    expect(moveVisualTabRow(rows, 3, 1, 'after').map((row) => row.tab?.tabId ?? row.kind)).toEqual(['group', 1, 3, 2]);
    expect(moveVisualTabRow(rows, 3, 1, 'before').map((row) => row.tab?.tabId ?? row.kind)).toEqual(['group', 3, 1, 2]);
  });

  it('opens a placeholder slot and removes the dragged card', () => {
    const rows = [
      { kind: 'group' as const },
      { kind: 'tab' as const, tab: { tabId: 1 } },
      { kind: 'tab' as const, tab: { tabId: 2 } },
      { kind: 'tab' as const, tab: { tabId: 3 } },
    ];
    const ids = (next: typeof rows) => next.map((row) => row.kind === 'tab' ? row.tab?.tabId : row.kind);
    expect(ids(placeVisualPlaceholder(rows, 3, { type: 'origin' }))).toEqual(['group', 1, 2, 'placeholder']);
    expect(ids(placeVisualPlaceholder(rows, 3, { type: 'before', tabId: 1 }))).toEqual(['group', 'placeholder', 1, 2]);
    expect(ids(placeVisualPlaceholder(rows, 3, { type: 'after', tabId: 1 }))).toEqual(['group', 1, 'placeholder', 2]);
    expect(ids(placeVisualPlaceholder(rows, 3, { type: 'end' }))).toEqual(['group', 1, 2, 'placeholder']);
  });

  it('routes stash and bookmark surfaces', () => {
    expect(resolveTabDragEnd({ ...base, over: { kind: 'stash' } })).toEqual({ type: 'stash', tabId: 5 });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'bookmark-nav' } })).toEqual({ type: 'file', tabId: 5 });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'bookmark-inbox' } })).toEqual({ type: 'file', tabId: 5 });
    expect(resolveTabDragEnd({ ...base, over: { kind: 'bookmark-folder', folderId: 'folder-9' } })).toEqual({
      type: 'file',
      tabId: 5,
      folderId: 'folder-9',
    });
  });
});
