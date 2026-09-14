import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import {
  isCleanupProtectedTab,
  isExplicitlyCloseableTab,
  dropPositionFromPoint,
  resolveTabMoveIndex,
  resolveUngroupedInsertIndex,
  restoreDescriptorKey,
  restoreInsertIndex,
  sortGroupsByStripOrder,
} from './tab-ops';

const tab = {
  pinned: false,
  active: false,
  audible: false,
  url: 'https://example.com/article',
  incognito: false,
};

describe('restore descriptor keys', () => {
  it('uses the same lookup key when creating and regrouping tabs', () => {
    const withId = { tabId: 42 };
    const withoutId = {};
    expect(restoreDescriptorKey(withId, 0)).toBe(42);
    expect(restoreDescriptorKey(withoutId, 0)).toBe(-1);
    expect(restoreDescriptorKey(withoutId, 2)).toBe(-3);
  });

  it('inserts into an existing window at the stored strip index', () => {
    expect(restoreInsertIndex({ index: 7 }, 0, false)).toBe(7);
    expect(restoreInsertIndex({ index: 7 }, 2, true)).toBe(2);
  });
});

describe('explicit close vs cleanup close', () => {
  const options = { protectedDomains: DEFAULT_SETTINGS.protectedDomains, incognitoEnabled: false };

  it('lets the user close the current tab, a pinned tab, an audible tab, and a protected-domain tab', () => {
    expect(isExplicitlyCloseableTab({ ...tab, active: true })).toBe(true);
    expect(isExplicitlyCloseableTab({ ...tab, pinned: true })).toBe(true);
    expect(isExplicitlyCloseableTab({ ...tab, audible: true })).toBe(true);
    expect(isExplicitlyCloseableTab({ ...tab, url: 'https://www.figma.com/file/abc' })).toBe(true);
    expect(isExplicitlyCloseableTab(undefined)).toBe(false);
  });

  it('keeps cleanup from closing protected tabs', () => {
    expect(isCleanupProtectedTab({ ...tab, active: true }, options)).toBe(true);
    expect(isCleanupProtectedTab({ ...tab, pinned: true }, options)).toBe(true);
    expect(isCleanupProtectedTab({ ...tab, audible: true }, options)).toBe(true);
    expect(isCleanupProtectedTab({ ...tab, url: 'https://www.figma.com/file/abc' }, options)).toBe(true);
    expect(isCleanupProtectedTab({ ...tab, url: 'http://localhost:3000' }, options)).toBe(true);
    expect(isCleanupProtectedTab(tab, options)).toBe(false);
  });
});

describe('tab move index', () => {
  const five = { pinnedCount: 0, tabCount: 5, pinned: false };

  it('moves the last tab to the first unpinned slot', () => {
    expect(resolveTabMoveIndex(4, { type: 'start' }, five)).toBe(0);
    expect(resolveTabMoveIndex(4, { type: 'start' }, { pinnedCount: 2, tabCount: 5, pinned: false })).toBe(2);
    expect(resolveTabMoveIndex(2, { type: 'start' }, { pinnedCount: 2, tabCount: 5, pinned: false })).toBeNull();
  });

  it('uses Chrome -1 so a tab can reach the end of the strip', () => {
    expect(resolveTabMoveIndex(0, { type: 'end' }, five)).toBe(-1);
    expect(resolveTabMoveIndex(3, { type: 'after', targetIndex: 4 }, five)).toBe(-1);
    expect(resolveTabMoveIndex(4, { type: 'end' }, five)).toBeNull();
    expect(resolveTabMoveIndex(4, { type: 'after', targetIndex: 4 }, five)).toBeNull();
  });

  it('keeps before/after inserts next to the target tab', () => {
    expect(resolveTabMoveIndex(4, { type: 'before', targetIndex: 0 }, five)).toBe(0);
    expect(resolveTabMoveIndex(0, { type: 'before', targetIndex: 4 }, five)).toBe(3);
    expect(resolveTabMoveIndex(4, { type: 'after', targetIndex: 0 }, five)).toBe(1);
    expect(resolveTabMoveIndex(1, { type: 'after', targetIndex: 2 }, five)).toBe(2);
  });

  it('will not park an unpinned tab among pinned tabs', () => {
    const pinnedHead = { pinnedCount: 2, tabCount: 6, pinned: false };
    expect(resolveTabMoveIndex(5, { type: 'before', targetIndex: 0 }, pinnedHead)).toBe(2);
  });

  it('reads before/after from the pointer, not a stale row half', () => {
    expect(dropPositionFromPoint(10, 0, 48)).toBe('before');
    expect(dropPositionFromPoint(40, 0, 48)).toBe('after');
  });

  it('places a drop on Ungrouped at the first ungrouped strip index', () => {
    expect(resolveUngroupedInsertIndex([
      { index: 0, groupId: 8 },
      { index: 1, groupId: 8 },
      { index: 2, groupId: -1 },
      { index: 3, groupId: -1 },
    ])).toBe(2);
    expect(resolveUngroupedInsertIndex([
      { index: 0, groupId: 8 },
      { index: 1, groupId: 8 },
    ])).toBe(-1);
  });
});

describe('group strip order', () => {
  it('sorts groups by the first tab index, not by groupId', () => {
    const groups = [
      { groupId: 90, title: 'Later' },
      { groupId: 10, title: 'Earlier' },
    ];
    const tabs = [
      { groupId: 90, index: 4 },
      { groupId: 10, index: 0 },
      { groupId: 10, index: 1 },
    ];
    expect(sortGroupsByStripOrder(groups, tabs).map((group) => group.groupId)).toEqual([10, 90]);
  });
});
