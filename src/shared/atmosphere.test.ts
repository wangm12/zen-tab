import { describe, expect, it } from 'vitest';
import {
  collectFolderUrls,
  folderSurfaceColor,
  groupSurfaceColor,
  pickFaviconStack,
  sampleParticleCell,
  selectAtmosphereCells,
  shouldAnimateAtmosphere,
  dotPatternDataUrl,
  ATMOSPHERE_CELL_TARGET,
  resolveStickyGroup,
  firstViewportIndex,
  stickyHeaderHasScrolledAway,
} from './atmosphere';

describe('sampleParticleCell', () => {
  it('is deterministic for a fixed seed', () => {
    expect(sampleParticleCell(7, 3, 4)).toEqual(sampleParticleCell(7, 3, 4));
    expect(sampleParticleCell(7, 3, 4)).not.toEqual(sampleParticleCell(8, 3, 4));
  });
});

describe('selectAtmosphereCells', () => {
  it('keeps a sparse field near the target count', () => {
    const cells = selectAtmosphereCells(40, 80, 11);
    expect(cells.length).toBeGreaterThan(40);
    expect(cells.length).toBeLessThanOrEqual(ATMOSPHERE_CELL_TARGET);
    expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length);
  });
});

describe('shouldAnimateAtmosphere', () => {
  it('runs only when enabled, visible, and motion is allowed', () => {
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: false, visible: true })).toBe(true);
    expect(shouldAnimateAtmosphere({ enabled: false, reducedMotion: false, documentHidden: false, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: true, documentHidden: false, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: true, visible: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ enabled: true, reducedMotion: false, documentHidden: false, visible: false })).toBe(false);
  });
});

describe('surface colors', () => {
  it('maps chrome group colors and keeps folder color stable', () => {
    expect(groupSurfaceColor('blue').wash).toMatch(/oklch/);
    expect(groupSurfaceColor('none').dot).toMatch(/oklch/);
    expect(folderSurfaceColor('folder-a')).toEqual(folderSurfaceColor('folder-a'));
    expect(folderSurfaceColor('folder-a').dot).not.toEqual(folderSurfaceColor('folder-b').dot);
  });
});

describe('pickFaviconStack', () => {
  it('returns at most three non-empty icons in order', () => {
    expect(pickFaviconStack(['a', '', undefined, 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(pickFaviconStack([])).toEqual([]);
  });
});

describe('group tab icons', () => {
  it('reads favicons from matching tabs in strip order', () => {
    expect(pickFaviconStack([
      undefined,
      'https://a/favicon.ico',
      'https://b/favicon.ico',
    ])).toEqual(['https://a/favicon.ico', 'https://b/favicon.ico']);
  });
});

describe('collectFolderUrls', () => {
  it('walks nested folder nodes in document order', () => {
    expect(collectFolderUrls([
      { kind: 'bookmark', bookmark: { url: 'https://a.example' } },
      { kind: 'folder', folder: { id: 'nested' }, children: [
        { kind: 'bookmark', bookmark: { url: 'https://b.example' } },
      ] },
    ])).toEqual(['https://a.example', 'https://b.example']);
    expect(collectFolderUrls([
      { kind: 'bookmark', bookmark: { url: 'https://a.example' } },
      { kind: 'bookmark', bookmark: { url: 'https://b.example' } },
      { kind: 'bookmark', bookmark: { url: 'https://c.example' } },
    ], 2)).toEqual(['https://a.example', 'https://b.example']);
  });
});

describe('dotPatternDataUrl', () => {
  it('emits a repeating svg data url for the given color', () => {
    const url = dotPatternDataUrl('oklch(66% 0.11 250)');
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(url)).toContain('oklch(66% 0.11 250)');
  });
});

describe('resolveStickyGroup', () => {
  const rows = [
    { kind: 'group', id: 1 },
    { kind: 'tab', id: 11 },
    { kind: 'tab', id: 12 },
    { kind: 'group', id: 2 },
    { kind: 'tab', id: 21 },
  ];
  it('returns null for empty or invalid index', () => {
    expect(resolveStickyGroup([], 0)).toBeNull();
    expect(resolveStickyGroup(rows, -1)).toBeNull();
  });
  it('returns the group when the first visible row is that group', () => {
    expect(resolveStickyGroup(rows, 0)).toEqual(rows[0]);
    expect(resolveStickyGroup(rows, 3)).toEqual(rows[3]);
  });
  it('walks back from a tab to the nearest previous group', () => {
    expect(resolveStickyGroup(rows, 2)).toEqual(rows[0]);
    expect(resolveStickyGroup(rows, 4)).toEqual(rows[3]);
  });
  it('returns null when only tabs precede the index', () => {
    expect(resolveStickyGroup([{ kind: 'tab' }, { kind: 'tab' }], 1)).toBeNull();
  });
  it('accepts bookmark folder headers as sticky chrome', () => {
    const bookmarkRows = [
      { kind: 'folder', id: 'bar' },
      { kind: 'bookmark', id: 'one' },
      { kind: 'inbox', id: 'inbox' },
    ];
    expect(resolveStickyGroup(bookmarkRows, 1, ['folder', 'inbox', 'search'])).toEqual(bookmarkRows[0]);
    expect(resolveStickyGroup(bookmarkRows, 2, ['folder', 'inbox', 'search'])).toEqual(bookmarkRows[2]);
  });
});

describe('firstViewportIndex', () => {
  const items = [
    { index: 0, start: 0, size: 52 },
    { index: 1, start: 52, size: 54 },
    { index: 2, start: 106, size: 54 },
  ];

  it('returns -1 for an empty virtual range', () => {
    expect(firstViewportIndex([], 0)).toBe(-1);
  });

  it('returns the first item whose bottom is below scrollOffset', () => {
    expect(firstViewportIndex(items, 0)).toBe(0);
    expect(firstViewportIndex(items, 51)).toBe(0);
    expect(firstViewportIndex(items, 52)).toBe(1);
  });

  it('skips overscan items that sit fully above the viewport', () => {
    expect(firstViewportIndex(items, 106)).toBe(2);
  });

  it('returns -1 when every item sits fully above scrollOffset', () => {
    expect(firstViewportIndex(items, 200)).toBe(-1);
  });
});

describe('stickyHeaderHasScrolledAway', () => {
  it('is true once the header bottom is at or above the viewport top', () => {
    expect(stickyHeaderHasScrolledAway(0, 52, 52)).toBe(true);
    expect(stickyHeaderHasScrolledAway(0, 52, 80)).toBe(true);
  });

  it('is false while the real header still intersects the viewport', () => {
    expect(stickyHeaderHasScrolledAway(0, 52, 0)).toBe(false);
    expect(stickyHeaderHasScrolledAway(0, 52, 51)).toBe(false);
  });
});
