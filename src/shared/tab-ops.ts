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
