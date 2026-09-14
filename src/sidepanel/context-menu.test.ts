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
      { id: 'discard', label: 'discardTab' },
      { id: 'close', label: 'close', danger: true },
    ]);
  });

  it('adds select/group/close on Ungrouped and keeps rename/color on real groups', () => {
    expect(buildGroupContextSpecs({ t, synthetic: true }).map((item) => item.id)).toEqual([
      'stash', 'select-all', 'group-tabs', 'close-all',
    ]);
    expect(buildGroupContextSpecs({ t, synthetic: false }).map((item) => item.id)).toEqual([
      'rename', 'colors', 'stash', 'select-all', 'close-all', 'ungroup',
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

  it('builds bookmark row and folder menus from mutate + inbox flags', () => {
    expect(buildBookmarkRowContextSpecs({ t, isInbox: false, canMutate: false }).map((item) => item.id))
      .toEqual(['open']);
    expect(buildBookmarkRowContextSpecs({ t, isInbox: true, canMutate: true }).map((item) => item.id))
      .toEqual(['open', 'file', 'edit', 'delete']);
    expect(buildBookmarkGroupContextSpecs({ t, collapsed: false, canMutate: true, isSpecialRoot: false }).map((item) => item.id))
      .toEqual(['collapse', 'open-all', 'new-folder', 'rename', 'delete']);
    expect(buildBookmarkGroupContextSpecs({ t, collapsed: true, canMutate: false, isSpecialRoot: true }).map((item) => item.id))
      .toEqual(['expand', 'open-all']);
  });
});
