import { describe, expect, it } from 'vitest';
import { Translator } from './i18n';
import {
  buildBookmarkGroupContextSpecs,
  buildBookmarkRowContextSpecs,
  buildEmptyCanvasContextSpecs,
  buildGroupContextSpecs,
  buildTabContextSpecs,
  clampMenuPosition,
  resolveTabContextTargets,
} from './context-menu';

const t = ((key: string) => key) as Translator;

describe('clampMenuPosition', () => {
  it('keeps a menu that already fits inside the 8px inset', () => {
    expect(clampMenuPosition(40, 50, 160, 200, 400, 500)).toEqual({ x: 40, y: 50 });
  });

  it('shifts left and up so the menu stays 8px inside the viewport', () => {
    expect(clampMenuPosition(360, 460, 160, 200, 400, 500)).toEqual({ x: 232, y: 292 });
  });

  it('never places the menu closer than 8px to the origin edges', () => {
    expect(clampMenuPosition(-20, -10, 160, 200, 400, 500)).toEqual({ x: 8, y: 8 });
  });

  it('pins oversized menus to the 8px inset', () => {
    expect(clampMenuPosition(20, 20, 500, 600, 400, 500)).toEqual({ x: 8, y: 8 });
  });
});

describe('resolveTabContextTargets', () => {
  it('uses only the clicked tab when it is not in the selection', () => {
    expect(resolveTabContextTargets(3, new Set([1, 2]))).toEqual([3]);
  });

  it('uses the full selection when the clicked tab is selected', () => {
    expect(resolveTabContextTargets(2, new Set([4, 2, 1]))).toEqual([4, 2, 1]);
  });

  it('falls back to the clicked tab when the selection is empty', () => {
    expect(resolveTabContextTargets(9, new Set())).toEqual([9]);
  });
});

describe('context menu specs', () => {
  it('builds tab items in Activate / Stash / Mute / Pin / Discard / Close order', () => {
    expect(buildTabContextSpecs({ t, muted: false, pinned: false }).map((item) => item.id)).toEqual([
      'activate', 'stash', 'mute', 'pin', 'discard', 'close',
    ]);
    expect(buildTabContextSpecs({ t, muted: true, pinned: true })).toEqual([
      { id: 'activate', label: 'activate' },
      { id: 'stash', label: 'stash' },
      { id: 'mute', label: 'unmute' },
      { id: 'pin', label: 'unpin' },
      { id: 'discard', label: 'discarded' },
      { id: 'close', label: 'close', danger: true },
    ]);
  });

  it('builds stash-only items for synthetic Ungrouped and full group actions otherwise', () => {
    expect(buildGroupContextSpecs({ t, synthetic: true })).toEqual([{ id: 'stash', label: 'stash' }]);
    expect(buildGroupContextSpecs({ t, synthetic: false }).map((item) => item.id)).toEqual([
      'rename', 'colors', 'stash', 'ungroup',
    ]);
    expect(buildGroupContextSpecs({ t, synthetic: false })).toContainEqual({
      id: 'colors',
      label: 'changeGroupColor',
      kind: 'swatches',
    });
    expect(buildGroupContextSpecs({ t, synthetic: false })).toContainEqual({
      id: 'ungroup',
      label: 'ungroup',
      danger: true,
    });
  });

  it('builds empty-canvas items as Group tabs / Clean up / Stash window / Export window', () => {
    expect(buildEmptyCanvasContextSpecs(t).map((item) => [item.id, item.label])).toEqual([
      ['group-tabs', 'groupTabs'],
      ['cleanup', 'cleanUp'],
      ['stash-window', 'stashWindow'],
      ['export-window', 'exportWindow'],
    ]);
  });

  it('adds File only for inbox bookmarks and emits collapse or expand from folder state', () => {
    expect(buildBookmarkRowContextSpecs({ t, isInbox: false })).toEqual([{ id: 'open', label: 'openBookmark' }]);
    expect(buildBookmarkRowContextSpecs({ t, isInbox: true })).toEqual([
      { id: 'open', label: 'openBookmark' },
      { id: 'file', label: 'fileBookmark' },
    ]);
    expect(buildBookmarkGroupContextSpecs({ t, collapsed: false })).toEqual([
      { id: 'collapse', label: 'collapseFolder' },
    ]);
    expect(buildBookmarkGroupContextSpecs({ t, collapsed: true })).toEqual([
      { id: 'expand', label: 'expandFolder' },
    ]);
  });
});
