import { describe, expect, it } from 'vitest';
import { snapshotFromChromeWindow, tabRecordFromChrome } from './tab-record';
import { DEFAULT_SETTINGS } from './types';

describe('tabRecordFromChrome', () => {
  it('maps a chrome tab and skips records without an id', () => {
    const record = tabRecordFromChrome({
      id: 12,
      windowId: 3,
      url: 'https://example.com/path?utm_source=ad',
      title: 'Example',
      index: 1,
      groupId: 8,
      pinned: true,
      active: true,
      discarded: true,
      mutedInfo: { muted: true },
    }, 100, 200);

    expect(record).toMatchObject({
      tabId: 12,
      windowId: 3,
      title: 'Example',
      groupId: 8,
      pinned: true,
      active: true,
      discarded: true,
      muted: true,
      createdAt: 100,
    });
    expect(record.canonicalUrl).toBe('https://example.com/path');
    expect(() => tabRecordFromChrome({ windowId: 3, index: 0 })).toThrow(/id/);
  });
});

describe('snapshotFromChromeWindow', () => {
  it('builds a current-window snapshot without waiting for other windows', () => {
    const snapshot = snapshotFromChromeWindow({
      windowId: 3,
      incognito: false,
      tabs: [
        { id: 12, windowId: 3, url: 'https://example.com', title: 'Example', index: 0 },
        { windowId: 3, url: 'https://skip.invalid', title: 'Missing id', index: 1 },
      ],
      groups: [{ id: 8, windowId: 3, title: 'Work', color: 'blue', collapsed: true }],
      settings: { ...DEFAULT_SETTINGS, language: 'zh' },
      stashes: [],
      projectMemory: [],
      hasCloudApiKey: true,
      now: 200,
    });

    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 3,
      focused: true,
      incognito: false,
    });
    expect(snapshot.windows[0].tabs).toHaveLength(1);
    expect(snapshot.windows[0].tabs[0].tabId).toBe(12);
    expect(snapshot.windows[0].groups).toEqual([{
      groupId: 8,
      windowId: 3,
      title: 'Work',
      color: 'blue',
      collapsed: true,
    }]);
    expect(snapshot.settings.language).toBe('zh');
    expect(snapshot.hasCloudApiKey).toBe(true);
  });
});
