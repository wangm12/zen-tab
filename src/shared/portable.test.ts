import { describe, expect, it } from 'vitest';
import { createId } from './ids';
import {
  exportStashAsJson,
  exportStashAsMarkdown,
  exportWindowAsJson,
  parseImportedStashes,
  parseOneTabText,
  stashFromOneTabEntries,
} from './portable';
import { StashRecord, WindowSnapshot } from './types';

const stash: StashRecord = {
  version: 1,
  id: 'stash-1',
  name: 'Research',
  createdAt: 1_700_000_000_000,
  sourceWindowId: 12,
  incognito: false,
  scope: 'window',
  tabs: [
    { url: 'https://a.example/docs', title: 'Docs', windowId: 12, index: 0, active: true, pinned: false, muted: false, groupId: 7, groupTitle: 'Zen Tab', groupColor: 'blue', groupCollapsed: true },
    { url: 'https://github.com/acme/zen-tab', title: 'Repo', windowId: 12, index: 1, active: false, pinned: false, muted: false, groupId: 7, groupTitle: 'Zen Tab', groupColor: 'blue', groupCollapsed: true },
    { url: 'https://news.example/item', title: 'News', windowId: 12, index: 2, active: false, pinned: true, muted: true, groupId: -1 },
  ],
};

describe('stash export', () => {
  it('round-trips JSON with group metadata, pin, and mute state', () => {
    const json = exportStashAsJson(stash);
    const parsed = JSON.parse(json) as { kind: string; stashes: StashRecord[] };
    expect(parsed.kind).toBe('zen-tab-stashes');
    expect(parsed.stashes[0].tabs[0].groupTitle).toBe('Zen Tab');
    expect(parsed.stashes[0].tabs[0].groupCollapsed).toBe(true);
    expect(parsed.stashes[0].tabs[2].pinned).toBe(true);
    const imported = parseImportedStashes(json);
    expect(imported).toHaveLength(1);
    expect(imported[0].tabs.map((tab) => tab.url)).toEqual(stash.tabs.map((tab) => tab.url));
  });

  it('exports markdown with grouped headings and links', () => {
    const markdown = exportStashAsMarkdown(stash);
    expect(markdown).toContain('# Research');
    expect(markdown).toContain('## Zen Tab');
    expect(markdown).toContain('[Docs](https://a.example/docs)');
    expect(markdown).toContain('## Ungrouped');
    expect(markdown).toContain('[News](https://news.example/item)');
  });
});

describe('OneTab import', () => {
  it('parses url | title lines and ignores blanks and comments', () => {
    const entries = parseOneTabText([
      'https://one.example/a | First tab',
      '',
      '# note',
      'https://one.example/b',
      'not a url',
    ].join('\n'));
    expect(entries).toEqual([
      { url: 'https://one.example/a', title: 'First tab' },
      { url: 'https://one.example/b', title: 'https://one.example/b' },
    ]);
  });

  it('builds a stash that stays within the library instead of opening tabs', () => {
    const imported = stashFromOneTabEntries([
      { url: 'https://one.example/a', title: 'First tab' },
      { url: 'https://one.example/b', title: 'https://one.example/b' },
    ], { now: 42, name: 'OneTab import' });
    expect(imported.version).toBe(1);
    expect(imported.name).toBe('OneTab import');
    expect(imported.createdAt).toBe(42);
    expect(imported.tabs).toHaveLength(2);
    expect(imported.tabs.every((tab) => tab.groupId === -1)).toBe(true);
    expect(imported.id.startsWith('stash-')).toBe(true);
  });
});

describe('import validation', () => {
  it('accepts a zen-tab JSON array and a wrapped export object', () => {
    const wrapped = parseImportedStashes(exportStashAsJson(stash));
    const rawArray = parseImportedStashes(JSON.stringify([stash]));
    expect(wrapped).toHaveLength(1);
    expect(rawArray).toHaveLength(1);
  });

  it('rejects malformed JSON and empty OneTab text', () => {
    expect(() => parseImportedStashes('{not json')).toThrow();
    expect(parseOneTabText('hello world')).toEqual([]);
  });

  it('exports the current window as a stash-shaped JSON payload', () => {
    const windowSnapshot: WindowSnapshot = {
      windowId: 9,
      focused: true,
      incognito: false,
      groups: [{ groupId: 3, windowId: 9, title: 'Work', color: 'green', collapsed: false }],
      tabs: [{
        tabId: 1,
        windowId: 9,
        incognito: false,
        url: 'https://work.example',
        canonicalUrl: 'https://work.example',
        title: 'Work',
        groupId: 3,
        pinned: false,
        active: true,
        audible: false,
        discarded: false,
        autoDiscardable: true,
        muted: false,
        index: 0,
        createdAt: 1,
      }],
    };
    const json = exportWindowAsJson(windowSnapshot, { now: 99, name: 'Window 1' });
    const imported = parseImportedStashes(json);
    expect(imported[0].name).toBe('Window 1');
    expect(imported[0].tabs[0].groupTitle).toBe('Work');
    expect(createId('stash').startsWith('stash-')).toBe(true);
  });
});
