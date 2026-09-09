import { TabRecord } from './types';
import { isSpecialUrl } from './url';

export function validateGroupTabsInput(tabs: TabRecord[], requestedIds: number[]): {
  windowId: number;
  tabIds: number[];
  skippedPinned: number;
  skippedMissing: number;
} {
  const byId = new Map(tabs.map((item) => [item.tabId, item]));
  const tabIds: number[] = [];
  let skippedPinned = 0;
  let skippedMissing = 0;

  for (const id of requestedIds) {
    const match = byId.get(id);
    if (!match) {
      skippedMissing += 1;
      continue;
    }
    if (match.pinned) {
      skippedPinned += 1;
      continue;
    }
    tabIds.push(id);
  }

  const remaining = tabIds.map((id) => byId.get(id)!);
  const windowIds = new Set(remaining.map((item) => item.windowId));
  if (windowIds.size > 1) throw new Error('Tabs must share the same window.');
  if (tabIds.length < 2) throw new Error('Select at least two unpinned tabs to group.');

  return {
    windowId: remaining[0].windowId,
    tabIds,
    skippedPinned,
    skippedMissing,
  };
}

export function selectEligibleGroupTabs(
  tabs: TabRecord[],
  windowId: number,
  options: { tabIds?: number[]; incognitoEnabled: boolean },
): TabRecord[] {
  const incognitoOk = (tab: TabRecord) => options.incognitoEnabled || !tab.incognito;
  if (options.tabIds?.length) {
    const byId = new Map(tabs.map((item) => [item.tabId, item]));
    const selected: TabRecord[] = [];
    for (const id of options.tabIds) {
      const match = byId.get(id);
      if (!match || match.windowId !== windowId || match.pinned || isSpecialUrl(match.url) || !incognitoOk(match)) continue;
      selected.push(match);
    }
    return selected;
  }

  return tabs
    .filter((tab) => tab.windowId === windowId && incognitoOk(tab) && !tab.pinned && tab.groupId === -1 && !isSpecialUrl(tab.url))
    .sort((left, right) => left.index - right.index);
}

export function isEligibleProposalTab(
  tab: TabRecord | undefined,
  options: {
    tabId: number;
    analyzed: Set<number>;
    seen: Set<number>;
    sourceWindowId: number;
    incognitoEnabled: boolean;
  },
): boolean {
  return Boolean(
    tab
    && options.analyzed.has(options.tabId)
    && !options.seen.has(options.tabId)
    && tab.windowId === options.sourceWindowId
    && !tab.pinned
    && !(tab.incognito && !options.incognitoEnabled),
  );
}
