import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n';
import { buildPaletteEntries } from './palette';
import { WindowSnapshot } from '../shared/types';

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
});
