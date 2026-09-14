import { isLocalAddress, isSpecialUrl, getHostname } from './url';

export function restoreDescriptorKey(descriptor: { tabId?: number }, index: number): number {
  return descriptor.tabId ?? -(index + 1);
}

export function restoreInsertIndex(descriptor: { index: number }, loopIndex: number, createdWindow: boolean): number {
  return createdWindow ? loopIndex : descriptor.index;
}

export type CloseableTab = {
  pinned: boolean;
  active: boolean;
  audible: boolean;
  url: string;
  incognito: boolean;
};

export function isExplicitlyCloseableTab(tab: CloseableTab | undefined): tab is CloseableTab {
  return Boolean(tab);
}

export function isCleanupProtectedTab(tab: CloseableTab, options: { protectedDomains: string[]; incognitoEnabled: boolean }): boolean {
  const host = getHostname(tab.url);
  return tab.pinned
    || tab.active
    || tab.audible
    || isSpecialUrl(tab.url)
    || isLocalAddress(tab.url)
    || (tab.incognito && !options.incognitoEnabled)
    || options.protectedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export type TabMovePlacement =
  | { type: 'start' }
  | { type: 'end' }
  | { type: 'before'; targetIndex: number }
  | { type: 'after'; targetIndex: number };

export function resolveTabMoveIndex(
  fromIndex: number,
  placement: TabMovePlacement,
  options: { pinnedCount: number; tabCount: number; pinned?: boolean },
): number | null {
  const { pinnedCount, tabCount, pinned = false } = options;
  if (tabCount <= 0 || fromIndex < 0) return null;
  const last = tabCount - 1;
  const minIndex = pinned ? 0 : pinnedCount;
  const maxIndex = pinned ? Math.max(0, pinnedCount - 1) : last;

  if (placement.type === 'start') {
    return fromIndex === minIndex ? null : minIndex;
  }
  if (placement.type === 'end') {
    if (fromIndex === last) return null;
    return pinned ? maxIndex : -1;
  }

  const target = placement.targetIndex;
  const movingForward = fromIndex < target;
  if (placement.type === 'after' && target >= last && !pinned) {
    return fromIndex === last ? null : -1;
  }

  let destination = placement.type === 'before'
    ? target - (movingForward ? 1 : 0)
    : target + (movingForward ? 0 : 1);
  destination = Math.max(minIndex, Math.min(pinned ? maxIndex : last, destination));
  return destination === fromIndex ? null : destination;
}

export function dropPositionFromPoint(clientY: number, top: number, height: number): 'before' | 'after' {
  return clientY < top + height / 2 ? 'before' : 'after';
}

export function resolveUngroupedInsertIndex(tabs: readonly { index: number; groupId: number }[]): number {
  let first = Number.POSITIVE_INFINITY;
  for (const tab of tabs) {
    if (tab.groupId === -1 && tab.index < first) first = tab.index;
  }
  return Number.isFinite(first) ? first : -1;
}

export function sortGroupsByStripOrder<G extends { groupId: number }, T extends { groupId: number; index: number }>(groups: G[], tabs: T[]): G[] {
  const firstIndex = new Map<number, number>();
  for (const tab of tabs) {
    if (tab.groupId === -1) continue;
    const current = firstIndex.get(tab.groupId);
    if (current == null || tab.index < current) firstIndex.set(tab.groupId, tab.index);
  }
  return [...groups].sort((left, right) => (
    (firstIndex.get(left.groupId) ?? Number.MAX_SAFE_INTEGER) - (firstIndex.get(right.groupId) ?? Number.MAX_SAFE_INTEGER)
    || left.groupId - right.groupId
  ));
}
