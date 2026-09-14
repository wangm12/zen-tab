import { VisibleBookmarkRow } from './bookmark-tree';
import { bookmarkMoveIndex, canFileIntoBookmarkParent, isBookmarkMoveCycle, isManagedBookmarkNode } from './bookmarks';
import { BookmarkFolderRecord } from './types';
import { DragSurface } from './tab-dnd';

export type BookmarkDragSource =
  | { type: 'bookmark'; id: string }
  | { type: 'folder'; id: string };

export type BookmarkDragOver =
  | DragSurface
  | { kind: 'bookmark-row'; id: string; parentId: string; index: number }
  | { kind: 'bookmark-folder-row'; id: string; parentId: string; index: number };

export type BookmarkDragEndResult =
  | { type: 'none' }
  | { type: 'move'; id: string; parentId: string; index?: number };

export type BookmarkDisplayRow = VisibleBookmarkRow | { kind: 'placeholder'; depth: number };

export type BookmarkPlaceholderDest =
  | { type: 'origin' }
  | { type: 'end' }
  | { type: 'before'; key: string }
  | { type: 'after'; key: string }
  | { type: 'after-header'; key: string };

const NONE: BookmarkDragEndResult = { type: 'none' };

export function bookmarkFolderHeaderOver({ placement: _placement, yRatio, sourceType }: {
  placement: 'before' | 'after';
  yRatio: number;
  isExpanded?: boolean;
  sourceType?: BookmarkDragSource['type'];
}): 'nest' | 'row' {
  if (sourceType === 'bookmark') {
    return 'nest';
  }
  return yRatio >= 0.40 && yRatio <= 0.60 ? 'nest' : 'row';
}

export function resolveBookmarkFolderHeaderHit(input: {
  sourceType?: BookmarkDragSource['type'];
  folderId: string;
  parentId: string;
  index: number;
  isSpecialRoot: boolean;
  isExpanded?: boolean;
  placement: 'before' | 'after';
  yRatio: number;
}): { over: BookmarkDragOver; placement?: 'before' | 'after' } {
  const row = {
    over: {
      kind: 'bookmark-folder-row' as const,
      id: input.folderId,
      parentId: input.parentId,
      index: input.index,
    },
    placement: input.placement,
  };
  if (input.sourceType === 'folder' && !input.isSpecialRoot) {
    const mode = bookmarkFolderHeaderOver({
      placement: input.placement,
      yRatio: input.yRatio,
      isExpanded: input.isExpanded,
      sourceType: input.sourceType,
    });
    if (mode === 'row') {
      return row;
    }
    return { over: { kind: 'bookmark-folder', folderId: input.folderId } };
  }
  return { over: { kind: 'bookmark-folder', folderId: input.folderId } };
}

export function findRootFolderRecord(
  folderId: string,
  folders: BookmarkFolderRecord[],
): BookmarkFolderRecord | undefined {
  let current = folders.find((f) => f.id === folderId);
  if (!current || current.isSpecialRoot) return undefined;
  while (current.parentId) {
    const parent = folders.find((f) => f.id === current!.parentId);
    if (!parent || parent.isSpecialRoot) {
      return current;
    }
    current = parent;
  }
  return current;
}

export function isRootBookmarkFolder(
  folderId: string,
  folders: BookmarkFolderRecord[],
): boolean {
  const folder = folders.find((f) => f.id === folderId);
  if (!folder) return true;
  if (folder.isSpecialRoot) return false;
  if (!folder.parentId) return true;
  const parent = folders.find((f) => f.id === folder.parentId);
  return !parent || parent.isSpecialRoot;
}

export function resolveBookmarkItemDropHit(input: {
  sourceType?: BookmarkDragSource['type'];
  sourceId?: string;
  isDraggedRoot: boolean;
  isLeftRail?: boolean;
  hoveredKind: 'bookmark' | 'folder';
  hoveredId: string;
  parentId: string;
  index: number;
  folders: BookmarkFolderRecord[];
  placement: 'before' | 'after';
}): { over: BookmarkDragOver; placement?: 'before' | 'after' } {
  if (input.sourceType === 'folder' && (input.isDraggedRoot || input.isLeftRail)) {
    const rootFolder = findRootFolderRecord(input.parentId, input.folders);
    if (rootFolder && rootFolder.id !== input.sourceId) {
      return {
        over: {
          kind: 'bookmark-folder-row',
          id: rootFolder.id,
          parentId: rootFolder.parentId ?? '',
          index: rootFolder.index,
        },
        placement: 'after',
      };
    }
  }
  return {
    over: input.hoveredKind === 'bookmark'
      ? { kind: 'bookmark-row', id: input.hoveredId, parentId: input.parentId, index: input.index }
      : { kind: 'bookmark-folder-row', id: input.hoveredId, parentId: input.parentId, index: input.index },
    placement: input.placement,
  };
}

export function bookmarkDragOverHighlight(
  over: BookmarkDragOver | null,
  placement?: 'before' | 'after',
): { key: string; mode: 'nest' | 'before' | 'after' } | null {
  if (!over) return null;
  if (over.kind === 'bookmark-folder') {
    return { key: formatBookmarkFolderRowId(over.folderId), mode: 'nest' };
  }
  if (over.kind === 'bookmark-inbox') return { key: 'inbox', mode: 'nest' };
  if (over.kind === 'bookmark-row') {
    return { key: formatBookmarkRowId(over.id), mode: placement === 'after' ? 'after' : 'before' };
  }
  if (over.kind === 'bookmark-folder-row') {
    return { key: formatBookmarkFolderRowId(over.id), mode: placement === 'after' ? 'after' : 'before' };
  }
  return null;
}

export function formatBookmarkRowId(id: string): string {
  return `bookmark-row-${id}`;
}

export function formatBookmarkFolderRowId(id: string): string {
  return `bookmark-folder-row-${id}`;
}

export function bookmarkPlaceholderDest(
  sourceId: string,
  hit: { over: BookmarkDragOver; placement?: 'before' | 'after' } | null,
): BookmarkPlaceholderDest {
  if (!hit) return { type: 'origin' };
  if (hit.over.kind === 'bookmark-folder') {
    const key = formatBookmarkFolderRowId(hit.over.folderId);
    if (sourceId === key) return { type: 'origin' };
    return { type: 'after-header', key };
  }
  if (hit.over.kind === 'bookmark-inbox') return { type: 'after-header', key: 'inbox' };
  if (hit.over.kind === 'bookmark-row') {
    const key = formatBookmarkRowId(hit.over.id);
    return sourceId === key ? { type: 'origin' } : { type: hit.placement === 'after' ? 'after' : 'before', key };
  }
  if (hit.over.kind === 'bookmark-folder-row') {
    const key = formatBookmarkFolderRowId(hit.over.id);
    return sourceId === key ? { type: 'origin' } : { type: hit.placement === 'after' ? 'after' : 'before', key };
  }
  return { type: 'origin' };
}

export function coerceBookmarkDragHit(
  hit: { over: BookmarkDragOver; placement?: 'before' | 'after' } | null,
  input: {
    draggedKey: string;
    clientY: number;
    lastRowBottom: number | null;
    scrollerTop: number;
    scrollerBottom: number;
    lastVisibleTarget?: { over: BookmarkDragOver; placement: 'after' } | null;
  },
): { over: BookmarkDragOver; placement?: 'before' | 'after' } | null {
  const overKey = hit?.over ? (
    hit.over.kind === 'bookmark-row' ? formatBookmarkRowId(hit.over.id)
    : hit.over.kind === 'bookmark-folder-row' ? formatBookmarkFolderRowId(hit.over.id)
    : hit.over.kind === 'bookmark-folder' ? formatBookmarkFolderRowId(hit.over.folderId)
    : null
  ) : null;
  const overSelf = overKey != null && overKey === input.draggedKey;
  const effective = overSelf ? null : hit;
  if (effective) return effective;
  if (input.clientY < input.scrollerTop || input.clientY > input.scrollerBottom) return null;
  if (input.lastRowBottom == null || input.clientY >= input.lastRowBottom - 12) {
    if (input.lastVisibleTarget) {
      const targetKey = input.lastVisibleTarget.over.kind === 'bookmark-row'
        ? formatBookmarkRowId(input.lastVisibleTarget.over.id)
        : input.lastVisibleTarget.over.kind === 'bookmark-folder-row'
          ? formatBookmarkFolderRowId(input.lastVisibleTarget.over.id)
          : null;
      if (targetKey !== input.draggedKey) {
        return input.lastVisibleTarget;
      }
    }
  }
  return null;
}

function bookmarkItemKey(row: BookmarkDisplayRow): string | undefined {
  if (row.kind === 'bookmark') return formatBookmarkRowId(row.bookmark.id);
  if (row.kind === 'folder') return formatBookmarkFolderRowId(row.folder.id);
  if (row.kind === 'empty-slot') return `bookmark-empty-slot-${row.folderId}`;
  return undefined;
}

function bookmarkHeaderKey(row: BookmarkDisplayRow): string | undefined {
  if (row.kind === 'inbox') return 'inbox';
  if (row.kind === 'folder') return formatBookmarkFolderRowId(row.folder.id);
  return undefined;
}

function bookmarkRowDepth(row: BookmarkDisplayRow): number | null {
  return row.kind === 'folder' || row.kind === 'bookmark' || row.kind === 'empty-slot' ? row.depth : null;
}

function isBookmarkDraggedRow(rows: readonly BookmarkDisplayRow[], draggedKey: string): (row: BookmarkDisplayRow) => boolean {
  const source = parseBookmarkDragSource(draggedKey);
  if (!source) return () => false;
  if (source.type === 'bookmark') {
    return (row) => row.kind === 'bookmark' && row.bookmark.id === source.id;
  }
  const start = rows.findIndex((row) => row.kind === 'folder' && row.folder.id === source.id);
  if (start < 0) return (row) => row.kind === 'folder' && row.folder.id === source.id;
  const depth = rows[start].kind === 'folder' ? rows[start].depth : 0;
  const removed = new Set<BookmarkDisplayRow>();
  removed.add(rows[start]);
  for (let index = start + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowDepth = bookmarkRowDepth(row);
    if (rowDepth != null && rowDepth > depth) {
      removed.add(row);
      continue;
    }
    if (row.kind === 'placeholder') continue;
    break;
  }
  return (row) => removed.has(row);
}

function bookmarkPlaceholderDepth(
  rows: readonly BookmarkDisplayRow[],
  draggedKey: string,
  dest: BookmarkPlaceholderDest,
): number {
  if (dest.type === 'after-header') {
    const header = rows.find((row) => bookmarkHeaderKey(row) === dest.key);
    if (header?.kind === 'folder') return header.depth + 1;
    if (header?.kind === 'inbox') return 1;
    return 0;
  }
  if (dest.type === 'before' || dest.type === 'after') {
    const item = rows.find((row) => bookmarkItemKey(row) === dest.key);
    if (item && (item.kind === 'folder' || item.kind === 'bookmark')) return item.depth;
  }
  const dragged = rows.find((row) => bookmarkItemKey(row) === draggedKey);
  return dragged && (dragged.kind === 'folder' || dragged.kind === 'bookmark') ? dragged.depth : 0;
}

export function placeBookmarkPlaceholder(
  rows: readonly BookmarkDisplayRow[],
  draggedKey: string,
  dest: BookmarkPlaceholderDest,
): BookmarkDisplayRow[] {
  const isDragged = isBookmarkDraggedRow(rows, draggedKey);
  const base = rows.filter((row) => row.kind !== 'placeholder' && !isDragged(row));
  const placeholder: BookmarkDisplayRow = {
    kind: 'placeholder',
    depth: bookmarkPlaceholderDepth(rows, draggedKey, dest),
  };

  if (dest.type === 'end') {
    return [...base, placeholder];
  }

  if (dest.type === 'origin') {
    const from = rows.findIndex((row) => row.kind !== 'placeholder' && isDragged(row));
    const insertAt = from < 0
      ? base.length
      : rows.slice(0, from).filter((row) => row.kind !== 'placeholder' && !isDragged(row)).length;
    const next = [...base];
    next.splice(insertAt, 0, placeholder);
    return next;
  }

  if (dest.type === 'after-header') {
    const headerId = dest.key;
    const over = base.findIndex((row) => bookmarkHeaderKey(row) === headerId);
    const next = [...base];
    next.splice(over < 0 ? next.length : over + 1, 0, placeholder);
    return next;
  }

  if (dest.type === 'before') {
    const itemId = dest.key;
    const over = base.findIndex((row) => bookmarkItemKey(row) === itemId);
    const next = [...base];
    if (over < 0) return [...next, placeholder];
    next.splice(over, 0, placeholder);
    return next;
  }

  if (dest.type === 'after') {
    const itemId = dest.key;
    const over = base.findIndex((row) => bookmarkItemKey(row) === itemId);
    const next = [...base];
    if (over < 0) return [...next, placeholder];

    const overRow = base[over];
    if (overRow.kind === 'folder') {
      const folderDepth = overRow.depth;
      let insertAt = over + 1;
      while (insertAt < base.length) {
        const row = base[insertAt];
        const rowDepth = bookmarkRowDepth(row);
        if (rowDepth != null && rowDepth > folderDepth) {
          insertAt += 1;
          continue;
        }
        break;
      }
      next.splice(insertAt, 0, placeholder);
      return next;
    }

    next.splice(over + 1, 0, placeholder);
    return next;
  }

  return [...base, placeholder];
}

export function settleBookmarkPlaceholder(
  current: readonly BookmarkDisplayRow[],
  sourceRows: readonly BookmarkDisplayRow[],
  draggedKey: string,
): BookmarkDisplayRow[] | null {
  const dragged = sourceRows.filter(isBookmarkDraggedRow(sourceRows, draggedKey));
  const at = current.findIndex((row) => row.kind === 'placeholder');
  if (at < 0 || !dragged.length) return null;
  const placeholder = current[at];
  const targetDepth = placeholder.kind === 'placeholder' ? placeholder.depth : 0;
  const rootDepth = bookmarkRowDepth(dragged[0]) ?? 0;
  const depthDelta = targetDepth - rootDepth;

  const adjustedDragged = dragged.map((row) => {
    if (depthDelta === 0) return row;
    if (row.kind === 'folder') return { ...row, depth: row.depth + depthDelta };
    if (row.kind === 'bookmark') return { ...row, depth: row.depth + depthDelta };
    if (row.kind === 'empty-slot') return { ...row, depth: row.depth + depthDelta };
    return row;
  });

  const next: BookmarkDisplayRow[] = current.filter((row) => row.kind !== 'placeholder');
  next.splice(at, 0, ...adjustedDragged);
  return next;
}

export function parseBookmarkDragSource(id: string): BookmarkDragSource | null {
  if (id.startsWith('bookmark-folder-row-')) {
    const folderId = id.slice('bookmark-folder-row-'.length);
    return folderId ? { type: 'folder', id: folderId } : null;
  }
  if (id.startsWith('bookmark-row-')) {
    const bookmarkId = id.slice('bookmark-row-'.length);
    return bookmarkId ? { type: 'bookmark', id: bookmarkId } : null;
  }
  return null;
}

function isNoneSurface(over: BookmarkDragOver): boolean {
  return over.kind === 'stash'
    || over.kind === 'tab'
    || over.kind === 'group'
    || over.kind === 'ungrouped'
    || over.kind === 'sticky-group'
    || over.kind === 'sticky-ungrouped'
    || over.kind === 'list-end'
    || over.kind === 'bookmark-nav';
}

export function resolveBookmarkDragEnd(input: {
  source: BookmarkDragSource;
  over: BookmarkDragOver | null;
  placement?: 'before' | 'after';
  otherBookmarksRootId: string | undefined;
  folders: BookmarkFolderRecord[];
  siblings: Array<{ id: string; index: number; parentId: string }>;
}): BookmarkDragEndResult {
  const { source, over, placement, otherBookmarksRootId, folders, siblings } = input;
  if (!over || isNoneSurface(over)) return NONE;

  if (over.kind === 'bookmark-inbox') {
    if (!otherBookmarksRootId) return NONE;
    const sourceSibling = siblings.find((sibling) => sibling.id === source.id);
    if (sourceSibling?.parentId === otherBookmarksRootId) {
      return NONE;
    }
    return { type: 'move', id: source.id, parentId: otherBookmarksRootId };
  }

  if (over.kind === 'bookmark-folder') {
    const dest = folders.find((folder) => folder.id === over.folderId);
    if (!dest || (dest.folderKind !== 'bar' && dest.folderKind !== 'folder')) return NONE;
    if (isManagedBookmarkNode(dest.id, folders)) return NONE;
    if (source.id === dest.id) return NONE;
    if (!canFileIntoBookmarkParent(dest.id, folders)) return NONE;
    if (source.type === 'folder' && isBookmarkMoveCycle(source.id, dest.id, folders)) return NONE;
    const sourceSibling = siblings.find((sibling) => sibling.id === source.id);
    if (sourceSibling?.parentId === dest.id && sourceSibling.index === 0) {
      return NONE;
    }
    return { type: 'move', id: source.id, parentId: dest.id, index: 0 };
  }

  if (over.kind === 'bookmark-row' || over.kind === 'bookmark-folder-row') {
    if (source.id === over.id) return NONE;
    if (!canFileIntoBookmarkParent(over.parentId, folders)) return NONE;
    if (source.type === 'folder' && isBookmarkMoveCycle(source.id, over.parentId, folders)) return NONE;
    const sourceSibling = siblings.find((sibling) => sibling.id === source.id);
    const targetIndex = bookmarkMoveIndex({
      fromIndex: sourceSibling?.index ?? 0,
      targetIndex: over.index,
      placement: placement ?? 'before',
      sameParent: sourceSibling?.parentId === over.parentId,
    });
    if (sourceSibling && sourceSibling.parentId === over.parentId) {
      if (targetIndex === sourceSibling.index || targetIndex === sourceSibling.index + 1) {
        return NONE;
      }
    }
    return {
      type: 'move',
      id: source.id,
      parentId: over.parentId,
      index: targetIndex,
    };
  }

  return NONE;
}
