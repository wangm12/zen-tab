import { describe, expect, test } from 'vitest';
import { parseTabDragId } from './tab-dnd';
import {
  bookmarkDragOverHighlight,
  bookmarkFolderHeaderOver,
  bookmarkPlaceholderDest,
  coerceBookmarkDragHit,
  findRootFolderRecord,
  formatBookmarkFolderRowId,
  formatBookmarkRowId,
  isRootBookmarkFolder,
  parseBookmarkDragSource,
  placeBookmarkPlaceholder,
  resolveBookmarkDragEnd,
  resolveBookmarkFolderHeaderHit,
  resolveBookmarkItemDropHit,
  settleBookmarkPlaceholder,
} from './bookmark-dnd';
import { VisibleBookmarkRow } from './bookmark-tree';

const folders = [
  { id: '1', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
  { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
  { id: '3', folderKind: 'mobile' as const, title: 'Mobile', folderPath: 'Mobile', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 2 },
  { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
  { id: '99', folderKind: 'managed' as const, title: 'Managed', folderPath: 'Managed', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 3, unmodifiable: 'managed' as const },
];

describe('bookmark drag ids', () => {
  test('do not collide with folder header ids', () => {
    expect(formatBookmarkRowId('abc')).toBe('bookmark-row-abc');
    expect(formatBookmarkFolderRowId('eng')).toBe('bookmark-folder-row-eng');
    expect(parseBookmarkDragSource('bookmark-row-abc')).toEqual({ type: 'bookmark', id: 'abc' });
    expect(parseBookmarkDragSource('bookmark-folder-row-eng')).toEqual({ type: 'folder', id: 'eng' });
    expect(parseTabDragId('bookmark-folder-row-eng')).toBeNull();
    expect(parseTabDragId('bookmark-row-abc')).toBeNull();
    expect(parseTabDragId('bookmark-folder-eng')).toEqual({ kind: 'bookmark-folder', folderId: 'eng' });
  });
});

describe('resolveBookmarkDragEnd', () => {
  const siblings = [
    { id: 'a', index: 0, parentId: 'eng' },
    { id: 'b', index: 1, parentId: 'eng' },
  ];

  test('inbox appends to Other root; nav and stash are none', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-inbox' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'move', id: 'a', parentId: '2' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-nav' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'stash' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('bar header is a nest destination', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: '1' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'move', id: 'a', parentId: '1', index: 0 });
  });

  test('rejects managed and folder cycles', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: '99' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: '2' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: '3' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'folder', id: 'eng' },
      over: { kind: 'bookmark-folder', folderId: 'eng' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('reorders with chrome move index', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'b', parentId: 'eng', index: 1 },
      placement: 'after',
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'move', id: 'a', parentId: 'eng', index: 2 });
  });

  test('rejects drop on a Mobile row', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'phone', parentId: '3', index: 0 },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'folder', id: 'eng' },
      over: { kind: 'bookmark-folder-row', id: 'phone-folder', parentId: '3', index: 0 },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('rejects drop on a managed descendant row', () => {
    const managedFolders = [
      ...folders,
      {
        id: 'policy-folder',
        parentId: '99',
        folderKind: 'folder' as const,
        title: 'Policy',
        folderPath: 'Managed / Policy',
        isInbox: false,
        isSpecialRoot: false,
        isBookmarksBar: false,
        index: 0,
      },
    ];
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'policy', parentId: 'policy-folder', index: 0 },
      otherBookmarksRootId: '2',
      folders: managedFolders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: 'policy-folder' },
      otherBookmarksRootId: '2',
      folders: managedFolders,
      siblings,
    })).toEqual({ type: 'none' });
  });

  test('reorders sibling folders via bookmark-folder-row', () => {
    const folderSiblings = [
      { id: 'eng', index: 0, parentId: '2' },
      { id: 'design', index: 1, parentId: '2' },
    ];
    const withDesign = [
      ...folders,
      {
        id: 'design',
        parentId: '2',
        folderKind: 'folder' as const,
        title: 'Design',
        folderPath: 'Other / Design',
        isInbox: false,
        isSpecialRoot: false,
        isBookmarksBar: false,
        index: 1,
      },
    ];
    expect(resolveBookmarkDragEnd({
      source: { type: 'folder', id: 'eng' },
      over: { kind: 'bookmark-folder-row', id: 'design', parentId: '2', index: 1 },
      placement: 'after',
      otherBookmarksRootId: '2',
      folders: withDesign,
      siblings: folderSiblings,
    })).toEqual({ type: 'move', id: 'eng', parentId: '2', index: 2 });
    expect(resolveBookmarkDragEnd({
      source: { type: 'folder', id: 'eng' },
      over: { kind: 'bookmark-folder', folderId: 'design' },
      placement: 'after',
      otherBookmarksRootId: '2',
      folders: withDesign,
      siblings: folderSiblings,
    })).toEqual({ type: 'move', id: 'eng', parentId: 'design', index: 0 });
  });

  test('filters out no-op moves for same item and same index', () => {
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'a', parentId: 'eng', index: 0 },
      placement: 'before',
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-row', id: 'b', parentId: 'eng', index: 1 },
      placement: 'before',
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'a' },
      over: { kind: 'bookmark-folder', folderId: 'eng' },
      otherBookmarksRootId: '2',
      folders,
      siblings,
    })).toEqual({ type: 'none' });
    expect(resolveBookmarkDragEnd({
      source: { type: 'bookmark', id: 'inbox-item' },
      over: { kind: 'bookmark-inbox' },
      otherBookmarksRootId: '2',
      folders,
      siblings: [{ id: 'inbox-item', index: 0, parentId: '2' }],
    })).toEqual({ type: 'none' });
  });
});

describe('bookmarkDragOverHighlight', () => {
  test('maps nest vs reorder placement to a row key', () => {
    expect(bookmarkDragOverHighlight({ kind: 'bookmark-folder', folderId: 'eng' })).toEqual({
      key: 'bookmark-folder-row-eng',
      mode: 'nest',
    });
    expect(bookmarkDragOverHighlight({ kind: 'bookmark-row', id: 'a', parentId: 'eng', index: 0 }, 'after')).toEqual({
      key: 'bookmark-row-a',
      mode: 'after',
    });
    expect(bookmarkDragOverHighlight({ kind: 'bookmark-inbox' })).toEqual({ key: 'inbox', mode: 'nest' });
    expect(bookmarkDragOverHighlight({ kind: 'stash' })).toBeNull();
  });
});

describe('bookmarkFolderHeaderOver', () => {
  test('before/after edges reorder; center nests', () => {
    expect(bookmarkFolderHeaderOver({ placement: 'before', yRatio: 0.1 })).toBe('row');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.9 })).toBe('row');
    expect(bookmarkFolderHeaderOver({ placement: 'before', yRatio: 0.5 })).toBe('nest');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.5 })).toBe('nest');
  });

  test('folder drag gives 80% to reordering (40% top, 40% bottom) and 20% to nest', () => {
    expect(bookmarkFolderHeaderOver({ placement: 'before', yRatio: 0.35, sourceType: 'folder' })).toBe('row');
    expect(bookmarkFolderHeaderOver({ placement: 'before', yRatio: 0.40, sourceType: 'folder' })).toBe('nest');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.50, sourceType: 'folder' })).toBe('nest');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.60, sourceType: 'folder' })).toBe('nest');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.65, sourceType: 'folder' })).toBe('row');
  });

  test('bookmark drag always nests into folder headers', () => {
    expect(bookmarkFolderHeaderOver({ placement: 'before', yRatio: 0.1, sourceType: 'bookmark' })).toBe('nest');
    expect(bookmarkFolderHeaderOver({ placement: 'after', yRatio: 0.9, sourceType: 'bookmark' })).toBe('nest');
  });
});

describe('root folder helpers and subtree bypass', () => {
  const treeFolders = [
    { id: '1', folderKind: 'bar' as const, title: 'Bar', folderPath: 'Bar', isInbox: false, isSpecialRoot: true, isBookmarksBar: true, index: 0 },
    { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
    { id: 'eng', parentId: '2', folderKind: 'folder' as const, title: 'Eng', folderPath: 'Other / Eng', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: 'sub', parentId: 'eng', folderKind: 'folder' as const, title: 'Sub', folderPath: 'Other / Eng / Sub', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: 'deep', parentId: 'sub', folderKind: 'folder' as const, title: 'Deep', folderPath: 'Other / Eng / Sub / Deep', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
  ];

  test('findRootFolderRecord resolves top-level user folder', () => {
    expect(findRootFolderRecord('eng', treeFolders)?.id).toBe('eng');
    expect(findRootFolderRecord('sub', treeFolders)?.id).toBe('eng');
    expect(findRootFolderRecord('deep', treeFolders)?.id).toBe('eng');
    expect(findRootFolderRecord('2', treeFolders)).toBeUndefined();
    expect(findRootFolderRecord('unknown', treeFolders)).toBeUndefined();
  });

  test('isRootBookmarkFolder identifies root vs subfolders', () => {
    expect(isRootBookmarkFolder('eng', treeFolders)).toBe(true);
    expect(isRootBookmarkFolder('sub', treeFolders)).toBe(false);
    expect(isRootBookmarkFolder('deep', treeFolders)).toBe(false);
    expect(isRootBookmarkFolder('2', treeFolders)).toBe(false);
  });

  test('resolveBookmarkItemDropHit bypasses open folder subtree when dragging a root folder', () => {
    // Dragging a root folder 'design' over a child bookmark inside 'eng'
    const result = resolveBookmarkItemDropHit({
      sourceType: 'folder',
      sourceId: 'design',
      isDraggedRoot: true,
      hoveredKind: 'bookmark',
      hoveredId: 'bookmark-1',
      parentId: 'eng',
      index: 2,
      folders: treeFolders,
      placement: 'before',
    });
    expect(result).toEqual({
      over: {
        kind: 'bookmark-folder-row',
        id: 'eng',
        parentId: '2',
        index: 0,
      },
      placement: 'after',
    });
  });

  test('resolveBookmarkItemDropHit bypasses deeply nested child bookmarks to root folder', () => {
    const result = resolveBookmarkItemDropHit({
      sourceType: 'folder',
      sourceId: 'design',
      isDraggedRoot: true,
      hoveredKind: 'bookmark',
      hoveredId: 'deep-bm',
      parentId: 'deep',
      index: 0,
      folders: treeFolders,
      placement: 'after',
    });
    expect(result).toEqual({
      over: {
        kind: 'bookmark-folder-row',
        id: 'eng',
        parentId: '2',
        index: 0,
      },
      placement: 'after',
    });
  });

  test('resolveBookmarkItemDropHit does not bypass when dragging a bookmark', () => {
    const result = resolveBookmarkItemDropHit({
      sourceType: 'bookmark',
      sourceId: 'bm-source',
      isDraggedRoot: false,
      hoveredKind: 'bookmark',
      hoveredId: 'bookmark-1',
      parentId: 'eng',
      index: 2,
      folders: treeFolders,
      placement: 'before',
    });
    expect(result).toEqual({
      over: {
        kind: 'bookmark-row',
        id: 'bookmark-1',
        parentId: 'eng',
        index: 2,
      },
      placement: 'before',
    });
  });

  test('resolveBookmarkItemDropHit un-nests a subfolder to root level when on the left rail', () => {
    const result = resolveBookmarkItemDropHit({
      sourceType: 'folder',
      sourceId: 'sub',
      isDraggedRoot: false,
      isLeftRail: true,
      hoveredKind: 'bookmark',
      hoveredId: 'bookmark-1',
      parentId: 'eng',
      index: 2,
      folders: treeFolders,
      placement: 'before',
    });
    expect(result).toEqual({
      over: {
        kind: 'bookmark-folder-row',
        id: 'eng',
        parentId: '2',
        index: 0,
      },
      placement: 'after',
    });
  });
});

describe('resolveBookmarkFolderHeaderHit', () => {
  const header = {
    folderId: 'design',
    parentId: '2',
    index: 1,
    isSpecialRoot: false,
    placement: 'after' as const,
    yRatio: 0.5,
  };

  test('a dragged folder stays beside on edges and nests in center; bookmarks always nest', () => {
    expect(resolveBookmarkFolderHeaderHit({ ...header, yRatio: 0.1, sourceType: 'folder', placement: 'before' })).toEqual({
      over: { kind: 'bookmark-folder-row', id: 'design', parentId: '2', index: 1 },
      placement: 'before',
    });
    expect(resolveBookmarkFolderHeaderHit({ ...header, yRatio: 0.5, sourceType: 'folder' })).toEqual({
      over: { kind: 'bookmark-folder', folderId: 'design' },
    });
    expect(resolveBookmarkFolderHeaderHit({ ...header, yRatio: 0.9, sourceType: 'folder', placement: 'after' })).toEqual({
      over: { kind: 'bookmark-folder-row', id: 'design', parentId: '2', index: 1 },
      placement: 'after',
    });
    expect(resolveBookmarkFolderHeaderHit({ ...header, yRatio: 0.1, sourceType: 'bookmark' })).toEqual({
      over: { kind: 'bookmark-folder', folderId: 'design' },
    });
    expect(resolveBookmarkFolderHeaderHit({ ...header, yRatio: 0.5, sourceType: 'bookmark' })).toEqual({
      over: { kind: 'bookmark-folder', folderId: 'design' },
    });
  });
});

describe('bookmarkPlaceholderDest', () => {
  test('maps nest to a gap under the header and rows to before/after', () => {
    expect(bookmarkPlaceholderDest('bookmark-row-a', { over: { kind: 'bookmark-folder', folderId: 'eng' } }))
      .toEqual({ type: 'after-header', key: 'bookmark-folder-row-eng' });
    expect(bookmarkPlaceholderDest('bookmark-row-a', {
      over: { kind: 'bookmark-row', id: 'b', parentId: 'eng', index: 1 },
      placement: 'after',
    })).toEqual({ type: 'after', key: 'bookmark-row-b' });
    expect(bookmarkPlaceholderDest('bookmark-row-a', {
      over: { kind: 'bookmark-row', id: 'a', parentId: 'eng', index: 0 },
      placement: 'before',
    })).toEqual({ type: 'origin' });
    expect(bookmarkPlaceholderDest('bookmark-folder-row-eng', {
      over: { kind: 'bookmark-folder', folderId: 'design' },
    })).toEqual({ type: 'after-header', key: 'bookmark-folder-row-design' });
    expect(bookmarkPlaceholderDest('bookmark-folder-row-eng', {
      over: { kind: 'bookmark-folder', folderId: 'eng' },
    })).toEqual({ type: 'origin' });
  });
});

const folder = (id: string, depth: number): VisibleBookmarkRow => ({
  kind: 'folder',
  folder: {
    id,
    title: id,
    index: 0,
    folderKind: 'folder',
    folderPath: id,
    isInbox: false,
    isSpecialRoot: false,
    isBookmarksBar: false,
  },
  count: 0,
  depth,
  collapsed: false,
});

const bookmark = (id: string, depth: number): VisibleBookmarkRow => ({
  kind: 'bookmark',
  bookmark: {
    id,
    parentId: 'eng',
    title: id,
    url: `https://${id}.com`,
    index: 0,
    dateAdded: 0,
    folderKind: 'folder',
    folderPath: 'eng',
    isInbox: false,
    isBookmarksBar: false,
  },
  depth,
  inbox: false,
});

describe('placeBookmarkPlaceholder', () => {
  test('opens the same gap as tabs and lifts a folder with its children', () => {
    const rows: VisibleBookmarkRow[] = [
      folder('eng', 0),
      bookmark('a', 1),
      bookmark('b', 1),
      folder('design', 0),
    ];
    const kinds = (next: ReturnType<typeof placeBookmarkPlaceholder>) => next.map((row) => (
      row.kind === 'folder' ? row.folder.id : row.kind === 'bookmark' ? row.bookmark.id : row.kind
    ));
    expect(kinds(placeBookmarkPlaceholder(rows, 'bookmark-row-b', { type: 'origin' })))
      .toEqual(['eng', 'a', 'placeholder', 'design']);
    expect(kinds(placeBookmarkPlaceholder(rows, 'bookmark-row-b', { type: 'before', key: 'bookmark-row-a' })))
      .toEqual(['eng', 'placeholder', 'a', 'design']);
    expect(kinds(placeBookmarkPlaceholder(rows, 'bookmark-folder-row-eng', { type: 'after-header', key: 'bookmark-folder-row-design' })))
      .toEqual(['design', 'placeholder']);
    const preview = placeBookmarkPlaceholder(rows, 'bookmark-row-b', { type: 'before', key: 'bookmark-row-a' });
    expect(kinds(settleBookmarkPlaceholder(preview, rows, 'bookmark-row-b') ?? [])).toEqual(['eng', 'b', 'a', 'design']);
  });

  test('places placeholder after an open folder by inserting after all its children', () => {
    const rows: VisibleBookmarkRow[] = [
      folder('eng', 0),
      bookmark('a', 1),
      bookmark('b', 1),
      folder('design', 0),
      folder('extra', 0),
    ];
    const kinds = (next: ReturnType<typeof placeBookmarkPlaceholder>) => next.map((row) => (
      row.kind === 'folder' ? row.folder.id : row.kind === 'bookmark' ? row.bookmark.id : row.kind
    ));
    const depths = (next: ReturnType<typeof placeBookmarkPlaceholder>) => next.map((row) => (
      row.kind === 'placeholder' ? row.depth : null
    )).filter((d) => d != null);

    const placed = placeBookmarkPlaceholder(rows, 'bookmark-folder-row-extra', {
      type: 'after',
      key: 'bookmark-folder-row-eng',
    });
    expect(kinds(placed)).toEqual(['eng', 'a', 'b', 'placeholder', 'design']);
    expect(depths(placed)).toEqual([0]);

    const settled = settleBookmarkPlaceholder(placed, rows, 'bookmark-folder-row-extra');
    expect(kinds(settled ?? [])).toEqual(['eng', 'a', 'b', 'extra', 'design']);
  });
});

describe('coerceBookmarkDragHit', () => {
  const lastTarget = {
    over: { kind: 'bookmark-row' as const, id: 'b', parentId: 'eng', index: 1 },
    placement: 'after' as const,
  };

  test('filters out self hit', () => {
    const hit = {
      over: { kind: 'bookmark-row' as const, id: 'a', parentId: 'eng', index: 0 },
      placement: 'before' as const,
    };
    expect(coerceBookmarkDragHit(hit, {
      draggedKey: 'bookmark-row-a',
      clientY: 100,
      lastRowBottom: 300,
      scrollerTop: 0,
      scrollerBottom: 500,
      lastVisibleTarget: lastTarget,
    })).toBeNull();
  });

  test('keeps valid non-self hit', () => {
    const hit = {
      over: { kind: 'bookmark-row' as const, id: 'b', parentId: 'eng', index: 1 },
      placement: 'before' as const,
    };
    expect(coerceBookmarkDragHit(hit, {
      draggedKey: 'bookmark-row-a',
      clientY: 100,
      lastRowBottom: 300,
      scrollerTop: 0,
      scrollerBottom: 500,
      lastVisibleTarget: lastTarget,
    })).toEqual(hit);
  });

  test('coerces to last visible target when pointer is past bottom of rows', () => {
    expect(coerceBookmarkDragHit(null, {
      draggedKey: 'bookmark-row-a',
      clientY: 320,
      lastRowBottom: 300,
      scrollerTop: 0,
      scrollerBottom: 500,
      lastVisibleTarget: lastTarget,
    })).toEqual(lastTarget);
  });

  test('returns null when pointer is outside scroller bounds', () => {
    expect(coerceBookmarkDragHit(null, {
      draggedKey: 'bookmark-row-a',
      clientY: 550,
      lastRowBottom: 300,
      scrollerTop: 0,
      scrollerBottom: 500,
      lastVisibleTarget: lastTarget,
    })).toBeNull();
  });
});

