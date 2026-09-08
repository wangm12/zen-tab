import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import {
  isCleanupProtectedTab,
  isExplicitlyCloseableTab,
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
