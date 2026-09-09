import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import { readLocalSnapshot, shouldFetchPaletteBookmarks } from './local-snapshot';

describe('shouldFetchPaletteBookmarks', () => {
  it('does not fetch the bookmark tree on a cold tabs-section open', () => {
    expect(shouldFetchPaletteBookmarks('tabs', '', false)).toBe(false);
    expect(shouldFetchPaletteBookmarks('tabs', 'docs', false)).toBe(true);
    expect(shouldFetchPaletteBookmarks('tabs', '', true)).toBe(true);
    expect(shouldFetchPaletteBookmarks('bookmarks', '', false)).toBe(false);
  });
});

describe('readLocalSnapshot', () => {
  it('reads the current window from Chrome APIs without the service worker', async () => {
    const snapshot = await readLocalSnapshot({
      windows: {
        getCurrent: async () => ({ id: 3, incognito: false }),
      },
      tabs: {
        query: async ({ windowId }: { windowId: number }) => {
          expect(windowId).toBe(3);
          return [{ id: 12, windowId: 3, url: 'https://example.com', title: 'Example', index: 0 }];
        },
      },
      tabGroups: {
        query: async ({ windowId }: { windowId: number }) => {
          expect(windowId).toBe(3);
          return [{ id: 8, windowId: 3, title: 'Work', color: 'blue' as const, collapsed: false }];
        },
      },
      storage: {
        local: {
          get: async () => ({
            'zen-tab.settings': { language: 'zh' },
            'zen-tab.stashes': [],
            'zen-tab.project-memory': [],
          }),
        },
      },
    });

    expect(snapshot.windows[0].tabs[0].tabId).toBe(12);
    expect(snapshot.windows[0].groups[0].groupId).toBe(8);
    expect(snapshot.settings.language).toBe('zh');
    expect(snapshot.settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });
});
