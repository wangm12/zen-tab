import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n';
import { buildPaletteEntries } from './palette';
import { BookmarkRecord, StashRecord, WindowSnapshot } from '../shared/types';

const t = createTranslator('en');

const windows: WindowSnapshot[] = [
  {
    windowId: 11,
    focused: true,
    incognito: false,
    groups: [],
    tabs: [{
      tabId: 101,
      windowId: 11,
      incognito: false,
      url: 'https://example.com',
      canonicalUrl: 'https://example.com',
      title: 'Example article',
      favIconUrl: 'https://example.com/favicon.ico',
      groupId: -1,
      pinned: false,
      active: true,
      audible: false,
      discarded: false,
      autoDiscardable: true,
      muted: false,
      index: 0,
      createdAt: 1,
    }],
  },
  {
    windowId: 22,
    focused: false,
    incognito: true,
    groups: [],
    tabs: [],
  },
];

const bookmarks: BookmarkRecord[] = [{
  id: 'bookmark-1',
  parentId: 'folder-1',
  title: 'React rendering guide',
  url: 'https://react.dev/learn/render-and-commit',
  folderPath: 'Bookmarks bar / Engineering',
  isInbox: false,
  isBookmarksBar: true,
  folderKind: 'bar',
  index: 0,
}];

const stashes: StashRecord[] = [{
  version: 1,
  id: 'research-1',
  name: 'Research dump',
  createdAt: 1,
  sourceWindowId: 11,
  incognito: false,
  tabs: [{
    url: 'https://papers.example/item',
    title: 'Papers',
    windowId: 11,
    index: 0,
    active: true,
    pinned: false,
    muted: false,
    groupId: -1,
  }],
}];

describe('command palette entries', () => {
  it('includes a switch-window command for each open window', () => {
    const entries = buildPaletteEntries(windows, '', t);
    const windowEntries = entries.filter((entry) => entry.commandId === 'switch-window');
    expect(windowEntries).toEqual([
      expect.objectContaining({ id: 'window-11', windowId: 11, detail: 'Switch window' }),
      expect.objectContaining({ id: 'window-22', windowId: 22, label: 'Private window' }),
    ]);
  });

  it('filters windows by the typed query', () => {
    const entries = buildPaletteEntries(windows, 'private', t);
    expect(entries.some((entry) => entry.commandId === 'switch-window' && entry.windowId === 22)).toBe(true);
    expect(entries.some((entry) => entry.commandId === 'switch-window' && entry.windowId === 11)).toBe(false);
  });

  it('keeps each jump-tab result tied to that tab favicon and host', () => {
    const entries = buildPaletteEntries(windows, 'example', t);
    expect(entries).toEqual([
      expect.objectContaining({
        commandId: 'jump-tab',
        label: 'Example article',
        detail: 'example.com · Switch to tab',
        favIconUrl: 'https://example.com/favicon.ico',
      }),
    ]);
  });

  it('includes fuzzy bookmark hits without changing the default argument', () => {
    expect(buildPaletteEntries(windows, 'rendering', t, bookmarks)).toEqual([
      expect.objectContaining({
        commandId: 'jump-bookmark',
        label: 'React rendering guide',
        detail: 'react.dev · Engineering',
        url: 'https://react.dev/learn/render-and-commit',
      }),
    ]);
    expect(buildPaletteEntries(windows, '', t).some((entry) => entry.commandId === 'jump-bookmark')).toBe(false);
  });

  it('includes a jump-stash hit when the query matches a stash name', () => {
    const entries = buildPaletteEntries(windows, 'research', t, [], stashes);
    expect(entries).toContainEqual(expect.objectContaining({
      id: 'stash-research-1',
      commandId: 'jump-stash',
      stashId: 'research-1',
      label: 'Research dump',
      detail: `1 · ${t('cmdJumpStash')}`,
    }));
  });

  it('omits jump-stash from the empty command dump', () => {
    expect(buildPaletteEntries(windows, '', t, bookmarks, stashes).some((entry) => entry.commandId === 'jump-stash')).toBe(false);
  });

  it('ranks a matching tab before a matching command', () => {
    const entries = buildPaletteEntries(windows, 'tab', t);
    const tabIndex = entries.findIndex((entry) => entry.commandId === 'jump-tab');
    const commandIndex = entries.findIndex((entry) => entry.commandId === 'group');
    expect(tabIndex).toBeGreaterThanOrEqual(0);
    expect(commandIndex).toBeGreaterThanOrEqual(0);
    expect(tabIndex).toBeLessThan(commandIndex);
  });

  it('defaults omitted bookmarks and stashes to empty lists', () => {
    const entries = buildPaletteEntries(windows, '', t);
    expect(entries.some((entry) => entry.commandId === 'jump-bookmark')).toBe(false);
    expect(entries.some((entry) => entry.commandId === 'jump-stash')).toBe(false);
    expect(entries.some((entry) => entry.commandId === 'switch-window')).toBe(true);
  });

  it('identifies and tags active tabs with badge and isActive property', () => {
    const entries = buildPaletteEntries(windows, '', t);
    const activeTabEntry = entries.find((entry) => entry.id === 'tab-101');
    expect(activeTabEntry).toEqual(expect.objectContaining({
      commandId: 'jump-tab',
      kind: 'active-tab',
      badge: 'Active',
      isActive: true,
      url: 'https://example.com',
    }));
  });

  it('matches the active tab when querying "active"', () => {
    const entries = buildPaletteEntries(windows, 'active', t);
    expect(entries.some((entry) => entry.id === 'tab-101' && entry.isActive)).toBe(true);
  });

  it('resolves favicon and tags bookmarks with Bookmark badge', () => {
    const bookmarkMatchingOpenTab: BookmarkRecord = {
      id: 'bm-example',
      parentId: 'folder-1',
      title: 'Example site',
      url: 'https://example.com',
      folderPath: 'Bookmarks bar',
      isInbox: false,
      isBookmarksBar: true,
      folderKind: 'bar',
      index: 0,
    };
    const entries = buildPaletteEntries(windows, 'example', t, [bookmarkMatchingOpenTab]);
    const bmEntry = entries.find((entry) => entry.id === 'bookmark-bm-example');
    expect(bmEntry).toEqual(expect.objectContaining({
      commandId: 'jump-bookmark',
      kind: 'bookmark',
      badge: 'Bookmark',
      favIconUrl: 'https://example.com/favicon.ico',
    }));
  });

  it('matches open tabs when searching by URL path/tokens', () => {
    const multiTabWindows: WindowSnapshot[] = [{
      windowId: 1,
      focused: true,
      incognito: false,
      groups: [],
      tabs: [{
        tabId: 999,
        windowId: 1,
        incognito: false,
        url: 'https://ouraring.com/product/horizon-silver',
        canonicalUrl: 'https://ouraring.com/product/horizon-silver',
        title: 'Smart Ring',
        favIconUrl: 'https://ouraring.com/favicon.ico',
        groupId: -1,
        pinned: false,
        active: false,
        audible: false,
        discarded: false,
        autoDiscardable: true,
        muted: false,
        index: 0,
        createdAt: 1,
      }],
    }];
    const entries = buildPaletteEntries(multiTabWindows, 'horizon-silver', t);
    expect(entries.some((entry) => entry.id === 'tab-999')).toBe(true);
  });
});
