import { describe, expect, test } from 'vitest';
import { TabRecord } from './types';
import { isEligibleProposalTab, selectEligibleGroupTabs, validateGroupTabsInput } from './group-tabs';

function tab(overrides: Partial<TabRecord> & Pick<TabRecord, 'tabId'>): TabRecord {
  return {
    windowId: 1,
    incognito: false,
    url: `https://example.com/${overrides.tabId}`,
    canonicalUrl: `https://example.com/${overrides.tabId}`,
    title: `Tab ${overrides.tabId}`,
    groupId: -1,
    pinned: false,
    active: false,
    audible: false,
    discarded: false,
    autoDiscardable: true,
    muted: false,
    index: overrides.tabId,
    createdAt: 0,
    ...overrides,
  };
}

describe('validateGroupTabsInput', () => {
  test('same window, 3 ungrouped → returns those 3', () => {
    const tabs = [tab({ tabId: 1 }), tab({ tabId: 2 }), tab({ tabId: 3 })];

    expect(validateGroupTabsInput(tabs, [3, 1, 2])).toEqual({
      windowId: 1,
      tabIds: [3, 1, 2],
      skippedPinned: 0,
      skippedMissing: 0,
    });
  });

  test('mixed windowIds → throws', () => {
    const tabs = [
      tab({ tabId: 1, windowId: 1 }),
      tab({ tabId: 2, windowId: 1 }),
      tab({ tabId: 3, windowId: 2 }),
    ];

    expect(() => validateGroupTabsInput(tabs, [1, 2, 3])).toThrow(Error);
  });

  test('pinned dropped; if 3 requested and 1 pinned, returns 2', () => {
    const tabs = [
      tab({ tabId: 1 }),
      tab({ tabId: 2, pinned: true }),
      tab({ tabId: 3 }),
    ];

    expect(validateGroupTabsInput(tabs, [1, 2, 3])).toEqual({
      windowId: 1,
      tabIds: [1, 3],
      skippedPinned: 1,
      skippedMissing: 0,
    });
  });

  test('already-grouped kept', () => {
    const tabs = [
      tab({ tabId: 1, groupId: 8 }),
      tab({ tabId: 2 }),
      tab({ tabId: 3, groupId: 8 }),
    ];

    expect(validateGroupTabsInput(tabs, [1, 2, 3])).toEqual({
      windowId: 1,
      tabIds: [1, 2, 3],
      skippedPinned: 0,
      skippedMissing: 0,
    });
  });

  test('1 eligible after drops → throws', () => {
    const tabs = [tab({ tabId: 1 }), tab({ tabId: 2, pinned: true })];

    expect(() => validateGroupTabsInput(tabs, [1, 2, 99])).toThrow(Error);
  });

  test('missing IDs counted in skippedMissing', () => {
    const tabs = [tab({ tabId: 1 }), tab({ tabId: 2 }), tab({ tabId: 3 })];

    expect(validateGroupTabsInput(tabs, [1, 99, 2, 100])).toEqual({
      windowId: 1,
      tabIds: [1, 2],
      skippedPinned: 0,
      skippedMissing: 2,
    });
  });
});

describe('selectEligibleGroupTabs', () => {
  test('omitted tabIds keeps ungrouped, unpinned, same-window http tabs', () => {
    const tabs = [
      tab({ tabId: 1, index: 2 }),
      tab({ tabId: 2, index: 0, pinned: true }),
      tab({ tabId: 3, index: 1, groupId: 9 }),
      tab({ tabId: 4, index: 3, windowId: 2 }),
      tab({ tabId: 5, index: 4, url: 'chrome://settings', canonicalUrl: null }),
      tab({ tabId: 6, index: 5, incognito: true }),
    ];

    expect(selectEligibleGroupTabs(tabs, 1, { incognitoEnabled: false }).map((item) => item.tabId)).toEqual([1]);
  });

  test('nonempty tabIds keeps already-grouped tabs and requested order', () => {
    const tabs = [
      tab({ tabId: 1, groupId: 4 }),
      tab({ tabId: 2 }),
      tab({ tabId: 3, pinned: true }),
      tab({ tabId: 4, url: 'chrome://extensions', canonicalUrl: null }),
      tab({ tabId: 5, windowId: 2 }),
      tab({ tabId: 6, incognito: true }),
    ];

    expect(selectEligibleGroupTabs(tabs, 1, {
      tabIds: [6, 5, 4, 3, 2, 1],
      incognitoEnabled: false,
    }).map((item) => item.tabId)).toEqual([2, 1]);
  });

  test('selected incognito tabs stay when incognito is enabled', () => {
    const tabs = [tab({ tabId: 1, incognito: true }), tab({ tabId: 2, incognito: true, groupId: 3 })];

    expect(selectEligibleGroupTabs(tabs, 1, {
      tabIds: [1, 2],
      incognitoEnabled: true,
    }).map((item) => item.tabId)).toEqual([1, 2]);
  });
});

describe('isEligibleProposalTab', () => {
  test('keeps already-grouped analyzed tabs', () => {
    const seen = new Set<number>();

    expect(isEligibleProposalTab(tab({ tabId: 8, groupId: 12 }), {
      tabId: 8,
      analyzed: new Set([8]),
      seen,
      sourceWindowId: 1,
      incognitoEnabled: false,
    })).toBe(true);
    expect(seen.size).toBe(0);
  });

  test('drops missing, unseen, duplicate, other-window, pinned, and disabled incognito tabs', () => {
    const seen = new Set([2]);
    const analyzed = new Set([1, 2, 3, 4, 5, 6]);

    expect(isEligibleProposalTab(undefined, { tabId: 1, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 9 }), { tabId: 9, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 2 }), { tabId: 2, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 3, windowId: 2 }), { tabId: 3, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 4, pinned: true }), { tabId: 4, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 5, incognito: true }), { tabId: 5, analyzed, seen, sourceWindowId: 1, incognitoEnabled: false })).toBe(false);
    expect(isEligibleProposalTab(tab({ tabId: 6, incognito: true }), { tabId: 6, analyzed, seen, sourceWindowId: 1, incognitoEnabled: true })).toBe(true);
  });
});
