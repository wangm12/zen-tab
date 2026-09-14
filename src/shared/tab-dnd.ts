import { placeListPlaceholder } from './list-dnd';
import { dropPositionFromPoint, resolveTabMoveIndex, resolveUngroupedInsertIndex } from './tab-ops';

export const TAB_DRAG_THRESHOLD_PX = 8;
export const TAB_DROP_ATTR = 'data-tab-drop';

export type DragSurface =
  | { kind: 'tab'; tabId: number }
  | { kind: 'group'; groupId: number }
  | { kind: 'ungrouped'; windowId: number }
  | { kind: 'sticky-group'; groupId: number }
  | { kind: 'sticky-ungrouped'; windowId: number }
  | { kind: 'stash' }
  | { kind: 'bookmark-nav' }
  | { kind: 'bookmark-folder'; folderId: string }
  | { kind: 'bookmark-inbox' }
  | { kind: 'list-end'; windowId: number };

export type TabDragEndResult =
  | { type: 'none' }
  | { type: 'move'; tabId: number; windowId: number; index: number }
  | { type: 'group'; tabId: number; groupId: number }
  | { type: 'ungroup'; tabId: number }
  | { type: 'ungroup-and-move'; tabId: number; windowId: number; index: number }
  | { type: 'stash'; tabId: number }
  | { type: 'file'; tabId: number; folderId?: string };

const NONE: TabDragEndResult = { type: 'none' };

let lastTabPlacement: 'before' | 'after' = 'before';

export function rememberTabPlacement(placement: 'before' | 'after'): void {
  lastTabPlacement = placement;
}

export function readTabPlacement(): 'before' | 'after' {
  return lastTabPlacement;
}

export function pointerDragDistance(fromX: number, fromY: number, toX: number, toY: number): number {
  return Math.hypot(toX - fromX, toY - fromY);
}

export function shouldActivatePointerDrag(distance: number, threshold = TAB_DRAG_THRESHOLD_PX): boolean {
  return distance >= threshold;
}

export function rememberTabDragHit<T>(previous: T | null, next: T | null, retain: boolean): T | null {
  if (next) return next;
  return retain ? previous : null;
}

export function coerceTabDragHit(
  hit: { surface: DragSurface; placement?: 'before' | 'after' } | null,
  input: { draggedTabId: number; clientY: number; lastTabBottom: number | null; scrollerTop: number; scrollerBottom: number; windowId: number },
): { surface: DragSurface; placement?: 'before' | 'after' } | null {
  const overSelf = hit?.surface.kind === 'tab' && hit.surface.tabId === input.draggedTabId;
  const effective = overSelf ? null : hit;
  if (effective) return effective;
  if (input.clientY < input.scrollerTop || input.clientY > input.scrollerBottom) return null;
  if (input.lastTabBottom == null || input.clientY >= input.lastTabBottom - 12) {
    return { surface: { kind: 'list-end', windowId: input.windowId } };
  }
  return null;
}

export function hitTestTabDragTarget(
  clientX: number,
  clientY: number,
  atPoint: (x: number, y: number) => Element | null,
): { surface: DragSurface; placement?: 'before' | 'after' } | null {
  const raw = atPoint(clientX, clientY);
  if (!raw || !('closest' in raw)) return null;
  const node = raw.closest(`[${TAB_DROP_ATTR}]`);
  if (!node) return null;
  const surface = parseTabDragId(node.getAttribute(TAB_DROP_ATTR) ?? '');
  if (!surface) return null;
  if (surface.kind === 'tab') {
    const rect = node.getBoundingClientRect();
    return { surface, placement: dropPositionFromPoint(clientY, rect.top, rect.height) };
  }
  return { surface };
}

export function formatTabDragId(surface: DragSurface): string {
  switch (surface.kind) {
    case 'tab':
      return `tab-${surface.tabId}`;
    case 'group':
      return `group-${surface.groupId}`;
    case 'ungrouped':
      return `ungrouped-${surface.windowId}`;
    case 'sticky-group':
      return `sticky-group-${surface.groupId}`;
    case 'sticky-ungrouped':
      return `sticky-ungrouped-${surface.windowId}`;
    case 'stash':
      return 'nav-stash';
    case 'bookmark-nav':
      return 'nav-bookmarks';
    case 'bookmark-folder':
      return `bookmark-folder-${surface.folderId}`;
    case 'bookmark-inbox':
      return 'bookmark-inbox';
    case 'list-end':
      return `list-end-${surface.windowId}`;
  }
}

function parseNumberTail(value: string, prefix: string): number | null {
  if (!value.startsWith(prefix)) return null;
  const tail = value.slice(prefix.length);
  if (!tail || !/^-?\d+$/.test(tail)) return null;
  return Number(tail);
}

export function parseTabDragId(id: string): DragSurface | null {
  if (id === 'nav-stash') return { kind: 'stash' };
  if (id === 'nav-bookmarks') return { kind: 'bookmark-nav' };
  if (id === 'bookmark-inbox') return { kind: 'bookmark-inbox' };
  if (id.startsWith('bookmark-folder-row-') || id.startsWith('bookmark-row-')) return null;
  if (id.startsWith('bookmark-folder-')) {
    const folderId = id.slice('bookmark-folder-'.length);
    return folderId ? { kind: 'bookmark-folder', folderId } : null;
  }
  const listEnd = parseNumberTail(id, 'list-end-');
  if (listEnd != null) return { kind: 'list-end', windowId: listEnd };
  const stickyUngrouped = parseNumberTail(id, 'sticky-ungrouped-');
  if (stickyUngrouped != null) return { kind: 'sticky-ungrouped', windowId: stickyUngrouped };
  const ungrouped = parseNumberTail(id, 'ungrouped-');
  if (ungrouped != null) return { kind: 'ungrouped', windowId: ungrouped };
  const stickyGroup = parseNumberTail(id, 'sticky-group-');
  if (stickyGroup != null) return { kind: 'sticky-group', groupId: stickyGroup };
  const group = parseNumberTail(id, 'group-');
  if (group != null) return { kind: 'group', groupId: group };
  const tab = parseNumberTail(id, 'tab-');
  if (tab != null) return { kind: 'tab', tabId: tab };
  return null;
}

export function resolveTabDragEnd(input: {
  dragged: { tabId: number; index: number; pinned: boolean; groupId: number };
  over: DragSurface | null;
  placement?: 'before' | 'after';
  windowId: number;
  tabs: readonly { tabId: number; index: number; groupId: number; pinned: boolean }[];
}): TabDragEndResult {
  const { dragged, over, placement, windowId, tabs } = input;
  if (!over) return NONE;
  if (over.kind === 'tab' && over.tabId === dragged.tabId) return NONE;

  const pinnedCount = tabs.filter((tab) => tab.pinned).length;
  const moveOptions = { pinnedCount, tabCount: tabs.length, pinned: dragged.pinned };

  if (over.kind === 'list-end') {
    const index = resolveTabMoveIndex(dragged.index, { type: 'end' }, moveOptions);
    return index == null ? NONE : { type: 'move', tabId: dragged.tabId, windowId, index };
  }

  if (over.kind === 'tab') {
    const target = tabs.find((tab) => tab.tabId === over.tabId);
    if (!target || !placement) return NONE;
    const index = resolveTabMoveIndex(dragged.index, { type: placement, targetIndex: target.index }, moveOptions);
    return index == null ? NONE : { type: 'move', tabId: dragged.tabId, windowId, index };
  }

  if (over.kind === 'group' || over.kind === 'sticky-group') {
    return dragged.groupId === over.groupId ? NONE : { type: 'group', tabId: dragged.tabId, groupId: over.groupId };
  }

  if (over.kind === 'ungrouped' || over.kind === 'sticky-ungrouped') {
    const insert = resolveUngroupedInsertIndex(tabs);
    const index = resolveTabMoveIndex(
      dragged.index,
      insert < 0 ? { type: 'end' } : { type: 'before', targetIndex: insert },
      moveOptions,
    );
    if (index == null) {
      return dragged.groupId === -1 ? NONE : { type: 'ungroup', tabId: dragged.tabId };
    }
    return { type: 'ungroup-and-move', tabId: dragged.tabId, windowId, index };
  }

  if (over.kind === 'stash') return { type: 'stash', tabId: dragged.tabId };
  if (over.kind === 'bookmark-nav' || over.kind === 'bookmark-inbox') return { type: 'file', tabId: dragged.tabId };
  return { type: 'file', tabId: dragged.tabId, folderId: over.folderId };
}

export type PlaceholderDest =
  | { type: 'origin' }
  | { type: 'end' }
  | { type: 'before'; tabId: number }
  | { type: 'after'; tabId: number }
  | { type: 'after-group'; groupId: number };

export function placeVisualPlaceholder<T extends { kind: string; tab?: { tabId: number }; id?: number }>(
  rows: readonly T[],
  draggedTabId: number,
  dest: PlaceholderDest,
): T[] {
  return placeListPlaceholder(rows, {
    dest: dest.type === 'before' || dest.type === 'after'
      ? { type: dest.type, id: dest.tabId }
      : dest.type === 'after-group'
        ? { type: 'after-header', id: dest.groupId }
        : dest,
    isPlaceholder: (row) => row.kind === 'placeholder',
    isDragged: (row) => row.kind === 'tab' && row.tab?.tabId === draggedTabId,
    itemId: (row) => row.kind === 'tab' ? row.tab?.tabId : undefined,
    headerId: (row) => row.kind === 'group' ? row.id : undefined,
    placeholder: { kind: 'placeholder' } as T,
  });
}

export function moveVisualTabRow<T extends { kind: string; tab?: { tabId: number } }>(
  rows: readonly T[],
  draggedTabId: number,
  overTabId: number,
  placement: 'before' | 'after',
): T[] {
  const from = rows.findIndex((row) => row.kind === 'tab' && row.tab?.tabId === draggedTabId);
  const over = rows.findIndex((row) => row.kind === 'tab' && row.tab?.tabId === overTabId);
  if (from < 0 || over < 0 || from === over) return rows as T[];
  const next = [...rows];
  const [item] = next.splice(from, 1);
  const adjustedOver = from < over ? over - 1 : over;
  next.splice(adjustedOver + (placement === 'after' ? 1 : 0), 0, item);
  return next;
}
