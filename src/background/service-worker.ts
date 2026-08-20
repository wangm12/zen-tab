import { buildProjectMemoryRules, cloudProposalForSidePanel, createAIProvider, heuristicCleanup } from '../shared/ai';
import { shouldAutoDiscard, shouldSkipDiscardAfterInspect } from '../shared/discard';
import { createId } from '../shared/ids';
import { hostPermissionForBaseUrl } from '../shared/openai';
import { extractGroupingPageTextInPage } from '../shared/page-text';
import { canonicalizeUrl, displayHostname, getHostname, isLocalAddress, isSpecialUrl } from '../shared/url';
import {
  ActionJournal,
  DEFAULT_SETTINGS,
  GroupProposal,
  StashRecord,
  ZenTabEvent,
  ZenTabMessage,
  ZenTabSettings,
  ZenTabSnapshot,
  TabRecord,
  TabGroupRecord,
  ProjectTabInput,
  CleanupProposal,
  GroupScanProgress,
  GroupUndoData,
  ProjectMemoryRule,
  TabRestoreDescriptor,
  RecentSession,
} from '../shared/types';
import {
  clearLastAction,
  deleteStash,
  listStashes,
  loadGroqApiKey,
  loadLastAction,
  loadProjectMemory,
  loadSettings,
  clearProjectMemory,
  saveGroqApiKey,
  saveLastAction,
  saveProjectMemory,
  saveSettings,
  saveStash,
  updateStash,
} from '../shared/storage';

const tabIndex = new Map<number, TabRecord>();
const canonicalIndex = new Map<string, Set<number>>();
const groupIndex = new Map<number, TabGroupRecord>();
const creationTimes = new Map<number, number>();
const pendingDuplicateChecks = new Map<number, ReturnType<typeof setTimeout>>();
const handledDuplicateTabs = new Set<number>();
const cleanupProposals = new Map<string, CleanupProposal>();
const startupTabIds = new Set<number>();
const ADAPTIVE_SUMMARY_LIMIT = 32;
const ADAPTIVE_SUMMARY_BUDGET_MS = 8_000;
const FULL_SUMMARY_BUDGET_MS = 30_000;
const SUMMARY_CONCURRENCY = 2;

type DuplicateUndoData = {
  kind: 'duplicate';
  newTab: TabRestoreDescriptor;
  candidate: TabRestoreDescriptor & {
    tabId: number;
    canonicalUrl: string | null;
    group?: TabGroupRecord;
  };
};

const AUTO_DISCARD_ALARM = 'zen-tab-auto-discard';
let settings: ZenTabSettings = DEFAULT_SETTINGS;
let lastAction: ActionJournal | undefined;
let initialized = false;
let initializing: Promise<void> | undefined;
let broadcastTimer: ReturnType<typeof setTimeout> | undefined;
let focusedWindowId: number = chrome.windows.WINDOW_ID_NONE;
let cloudApiKey = '';
let stashesCache: StashRecord[] = [];
let projectMemory: ProjectMemoryRule[] = [];
let snapshotCache: ZenTabSnapshot | undefined;
let snapshotDirty = true;
let mutationQueue = Promise.resolve();

function runMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function asTabRecord(tab: chrome.tabs.Tab): TabRecord {
  if (tab.id == null) throw new Error('Chrome returned a tab without an id.');
  const existing = tabIndex.get(tab.id);
  const createdAt = existing?.createdAt ?? creationTimes.get(tab.id) ?? Date.now();
  creationTimes.set(tab.id, createdAt);
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    incognito: tab.incognito,
    url: tab.url ?? tab.pendingUrl ?? '',
    canonicalUrl: canonicalizeUrl(tab.url ?? tab.pendingUrl),
    title: tab.title ?? 'Untitled tab',
    favIconUrl: tab.favIconUrl,
    groupId: tab.groupId ?? -1,
    pinned: Boolean(tab.pinned),
    active: Boolean(tab.active),
    audible: Boolean(tab.audible),
    discarded: Boolean(tab.discarded),
    autoDiscardable: tab.autoDiscardable !== false,
    muted: Boolean(tab.mutedInfo?.muted),
    index: tab.index,
    status: tab.status,
    lastAccessed: tab.lastAccessed,
    createdAt,
  };
}

function scopeKey(tab: TabRecord): string {
  return `${tab.incognito ? 'incognito' : 'normal'}:${tab.canonicalUrl}`;
}

function removeFromCanonicalIndex(tab: TabRecord | undefined): void {
  if (!tab?.canonicalUrl) return;
  const key = scopeKey(tab);
  const ids = canonicalIndex.get(key);
  ids?.delete(tab.tabId);
  if (ids?.size === 0) canonicalIndex.delete(key);
}

function removeWindowState(windowId: number): void {
  for (const [tabId, tab] of tabIndex) {
    if (tab.windowId !== windowId) continue;
    const pending = pendingDuplicateChecks.get(tabId);
    if (pending) clearTimeout(pending);
    pendingDuplicateChecks.delete(tabId);
    removeFromCanonicalIndex(tab);
    tabIndex.delete(tabId);
    creationTimes.delete(tabId);
    startupTabIds.delete(tabId);
    handledDuplicateTabs.delete(tabId);
  }
  for (const [groupId, group] of groupIndex) {
    if (group.windowId === windowId) groupIndex.delete(groupId);
  }
}

function indexTab(tab: TabRecord): void {
  removeFromCanonicalIndex(tabIndex.get(tab.tabId));
  tabIndex.set(tab.tabId, tab);
  if (!tab.canonicalUrl) return;
  const key = scopeKey(tab);
  const ids = canonicalIndex.get(key) ?? new Set<number>();
  ids.add(tab.tabId);
  canonicalIndex.set(key, ids);
}

async function initialize(): Promise<void> {
  if (initialized) return;
  if (initializing) return initializing;
  initializing = (async () => {
    settings = await loadSettings();
    lastAction = await loadLastAction();
    stashesCache = await listStashes();
    projectMemory = await loadProjectMemory();
    cloudApiKey = await loadGroqApiKey();
    try {
      focusedWindowId = (await chrome.windows.getLastFocused()).id ?? chrome.windows.WINDOW_ID_NONE;
    } catch {
      focusedWindowId = chrome.windows.WINDOW_ID_NONE;
    }
    const tabs = focusedWindowId === chrome.windows.WINDOW_ID_NONE
      ? await chrome.tabs.query({})
      : await chrome.tabs.query({ windowId: focusedWindowId });
    for (const tab of tabs) {
      if (tab.id != null) startupTabIds.add(tab.id);
      indexTab(asTabRecord(tab));
    }
    try {
      const groups = focusedWindowId === chrome.windows.WINDOW_ID_NONE
        ? await chrome.tabGroups.query({})
        : await chrome.tabGroups.query({ windowId: focusedWindowId });
      for (const group of groups) {
        groupIndex.set(group.id, {
          groupId: group.id,
          windowId: group.windowId,
          title: group.title ?? '',
          color: group.color,
          collapsed: Boolean(group.collapsed),
        });
      }
    } catch {
      // Some Chrome versions can return an empty group list during startup.
    }
    initialized = true;
    snapshotDirty = true;
    await syncAutoDiscardAlarm();
    if (focusedWindowId !== chrome.windows.WINDOW_ID_NONE) void hydrateRemainingWindows();
  })();
  await initializing;
}

async function hydrateRemainingWindows(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      indexTab(asTabRecord(tab));
    }
    const groups = await chrome.tabGroups.query({});
    for (const group of groups) groupIndex.set(group.id, tabGroupFromChrome(group));
    scheduleSnapshotBroadcast();
  } catch {
    // The focused window remains usable if background hydration is interrupted.
  }
}

async function refreshWindowTabIndexes(windowId: number): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    for (const tab of tabs) indexTab(asTabRecord(tab));
    scheduleSnapshotBroadcast();
  } catch {
    // The next tab lifecycle event will reconcile the window if it disappears mid-refresh.
  }
}

function getWindowSnapshots(): ZenTabSnapshot['windows'] {
  const windows = new Map<number, TabRecord[]>();
  for (const tab of tabIndex.values()) {
    windows.set(tab.windowId, [...(windows.get(tab.windowId) ?? []), tab]);
  }
  return [...windows.entries()]
    .map(([windowId, tabs]) => ({
      windowId,
      focused: windowId === focusedWindowId,
      incognito: tabs[0]?.incognito ?? false,
      tabs: tabs.sort((a, b) => a.index - b.index),
      groups: [...groupIndex.values()].filter((group) => group.windowId === windowId),
    }))
    .sort((a, b) => Number(b.focused) - Number(a.focused) || a.windowId - b.windowId);
}

async function buildSnapshot(): Promise<ZenTabSnapshot> {
  await initialize();
  if (!snapshotCache || snapshotDirty) {
    snapshotCache = {
      windows: getWindowSnapshots(),
      stashes: stashesCache,
      projectMemory,
      settings,
      hasCloudApiKey: Boolean(cloudApiKey),
      lastAction,
    };
    snapshotDirty = false;
  }
  return snapshotCache;
}

function sendEvent(event: ZenTabEvent): void {
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

function scheduleSnapshotBroadcast(): void {
  snapshotDirty = true;
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    broadcastTimer = undefined;
    void buildSnapshot().then((snapshot) => sendEvent({ type: 'SNAPSHOT_UPDATED', snapshot }));
  }, 75);
}

function isIgnored(tab: TabRecord): boolean {
  const host = getHostname(tab.url);
  return settings.ignoredDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function canCompare(tab: TabRecord): boolean {
  if (!settings.duplicateEnabled || !tab.canonicalUrl || tab.pinned || isSpecialUrl(tab.url) || isIgnored(tab)) return false;
  if (tab.incognito && !settings.incognitoEnabled) return false;
  return true;
}

function duplicateCandidate(newTab: TabRecord): TabRecord | undefined {
  if (!newTab.canonicalUrl) return undefined;
  const ids = canonicalIndex.get(scopeKey(newTab));
  if (!ids) return undefined;
  const candidates = [...ids]
    .map((id) => tabIndex.get(id))
    .filter((tab): tab is TabRecord => Boolean(tab && tab.tabId !== newTab.tabId && tab.canonicalUrl && !isSpecialUrl(tab.url) && !isIgnored(tab)))
    .filter((tab) => settings.duplicateScope === 'all-normal-windows' || tab.windowId === newTab.windowId);
  candidates.sort((left, right) => {
    const pinnedScore = Number(right.pinned) - Number(left.pinned);
    if (pinnedScore) return pinnedScore;
    const sameWindowScore = Number(right.windowId === newTab.windowId) - Number(left.windowId === newTab.windowId);
    if (sameWindowScore) return sameWindowScore;
    return (right.lastAccessed ?? right.createdAt) - (left.lastAccessed ?? left.createdAt);
  });
  return candidates[0];
}

async function persistAction(action: ActionJournal): Promise<void> {
  lastAction = action;
  snapshotDirty = true;
  await saveLastAction(action);
}

function createTabInput(tab: TabRecord, summary?: string): ProjectTabInput {
  return { tabId: tab.tabId, title: tab.title, url: tab.url, canonicalUrl: tab.canonicalUrl, summary, lastAccessed: tab.lastAccessed };
}

function restoreDescriptorFromTab(tab: TabRecord, group?: TabGroupRecord): TabRestoreDescriptor {
  return {
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    windowId: tab.windowId,
    favIconUrl: tab.favIconUrl,
    index: tab.index,
    active: tab.active,
    pinned: tab.pinned,
    muted: tab.muted,
    groupId: tab.groupId,
    groupTitle: group?.title,
    groupColor: group?.color,
    groupCollapsed: group?.collapsed,
  };
}

function duplicateToastCopy(isForeground: boolean, host: string): string {
  return settings.language === 'zh'
    ? (isForeground ? `已在 ${host} 打开。` : '重复标签已收起。')
    : (isForeground ? `Already open in ${host}.` : 'Duplicate tab tucked away.');
}

async function maybeHandleDuplicate(tabId: number): Promise<void> {
  const tab = tabIndex.get(tabId);
  if (!tab || startupTabIds.has(tabId) || tab.status === 'loading' || !canCompare(tab) || handledDuplicateTabs.has(tabId)) return;
  const candidate = duplicateCandidate(tab);
  if (!candidate) return;
  handledDuplicateTabs.add(tabId);
  const isForeground = tab.active;
  const action: ActionJournal = {
    actionId: createId('action'),
    type: 'duplicate',
    createdAt: Date.now(),
      affectedTabIds: [tab.tabId, candidate.tabId],
      restoreData: {
        kind: 'duplicate',
        newTab: restoreDescriptorFromTab(tab, tab.groupId !== -1 ? groupIndex.get(tab.groupId) : undefined),
        candidate: {
          ...restoreDescriptorFromTab(candidate, candidate.groupId !== -1 ? groupIndex.get(candidate.groupId) : undefined),
          tabId: candidate.tabId,
          canonicalUrl: candidate.canonicalUrl,
          group: candidate.groupId !== -1 ? groupIndex.get(candidate.groupId) : undefined,
        },
    } satisfies DuplicateUndoData,
    expiresAt: Date.now() + 30_000,
  };
  try {
    await chrome.tabs.remove(tab.tabId);
    await persistAction(action);
  } catch {
    handledDuplicateTabs.delete(tabId);
    return;
  }
  try {
    if (isForeground) {
      await chrome.windows.update(candidate.windowId, { focused: true });
      await chrome.tabs.update(candidate.tabId, { active: true });
    } else if (candidate.windowId === tab.windowId && !candidate.pinned) {
      await chrome.tabs.move(candidate.tabId, { windowId: candidate.windowId, index: -1 });
    }
    sendEvent({
      type: 'TOAST',
      toast: {
        id: action.actionId,
        tone: 'success',
        message: duplicateToastCopy(isForeground, displayHostname(candidate.url)),
        action: 'undo',
      },
    });
  } catch {
    sendEvent({
      type: 'TOAST',
      toast: {
        id: action.actionId,
        tone: 'warning',
        message: settings.language === 'zh' ? '重复标签已关闭，可使用撤销恢复。' : 'Duplicate tab closed; Undo can restore it.',
        action: 'undo',
      },
    });
  }
}

function scheduleDuplicateCheck(tabId: number): void {
  const previous = pendingDuplicateChecks.get(tabId);
  if (previous) clearTimeout(previous);
  pendingDuplicateChecks.set(tabId, setTimeout(() => {
    pendingDuplicateChecks.delete(tabId);
    void runMutation(() => maybeHandleDuplicate(tabId)).catch(() => undefined);
  }, 50));
}

function tabGroupFromChrome(group: chrome.tabGroups.TabGroup): TabGroupRecord {
  return {
    groupId: group.id,
    windowId: group.windowId,
    title: group.title ?? '',
    color: group.color,
    collapsed: Boolean(group.collapsed),
  };
}

function summaryPriority(input: ProjectTabInput): number {
  const title = input.title.trim();
  const titleWords = title.split(/\s+/).filter((word) => word.length >= 3);
  let priority = 0;
  if (!title || titleWords.length < 4) priority += 3;
  if (input.url.length < 25) priority += 2;
  if (/^(new tab|home|untitled|loading|sign in|log in)$/i.test(title)) priority += 2;
  return priority;
}

async function prepareGroupInputs(windowId: number, deepScanAll: boolean): Promise<{ inputs: ProjectTabInput[]; deepAnalysisUsed: boolean; proposal?: GroupProposal }> {
  await initialize();
  const eligible = [...tabIndex.values()]
    .filter((tab) => tab.windowId === windowId && (settings.incognitoEnabled || !tab.incognito) && !tab.pinned && tab.groupId === -1 && !isSpecialUrl(tab.url))
    .sort((left, right) => left.index - right.index);
  const inputs = eligible.map((tab) => createTabInput(tab));
  const finalize = async (preparedInputs: ProjectTabInput[], deepAnalysisUsed: boolean) => {
    if (settings.aiProvider !== 'openai-compatible' || !cloudApiKey) return { inputs: preparedInputs, deepAnalysisUsed };
    const proposal = await createAIProvider(settings, cloudApiKey).proposeProjects(preparedInputs);
    const cloudProposal = cloudProposalForSidePanel(proposal);
    return {
      inputs: preparedInputs,
      deepAnalysisUsed,
      ...(cloudProposal
        ? { proposal: { ...cloudProposal, sourceWindowId: windowId, analyzedTabIds: preparedInputs.map((input) => input.tabId) } }
        : {}),
    };
  };
  const fullScan = deepScanAll && settings.deepAnalysisEnabled;
  const summaryInputs = (fullScan
    ? inputs
    : inputs
      .filter((input) => summaryPriority(input) > 0)
      .sort((left, right) => summaryPriority(right) - summaryPriority(left)))
    .slice(0, fullScan ? inputs.length : ADAPTIVE_SUMMARY_LIMIT);
  if (!summaryInputs.length) return finalize(inputs, false);

  let permission = false;
  try {
    permission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    permission = false;
  }
  if (!permission) return finalize(inputs, false);

  const withSummaries = new Map<number, string>();
  const mode: GroupScanProgress['mode'] = fullScan ? 'full' : 'adaptive';
  const total = summaryInputs.length;
  const deadline = Date.now() + (fullScan ? FULL_SUMMARY_BUDGET_MS : ADAPTIVE_SUMMARY_BUDGET_MS);
  let cursor = 0;
  let scanned = 0;
  let lastProgressAt = 0;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 100) return;
    lastProgressAt = now;
    sendEvent({ type: 'GROUP_SCAN_PROGRESS', windowId, scanned, total, mode });
  };
  reportProgress(true);
  const worker = async () => {
    while (cursor < summaryInputs.length && Date.now() < deadline) {
      const input = summaryInputs[cursor++];
      try {
        const result = await chrome.scripting.executeScript({
          target: { tabId: input.tabId },
          func: extractGroupingPageTextInPage,
        });
        const summary = result[0]?.result;
        if (typeof summary === 'string' && summary) withSummaries.set(input.tabId, summary);
      } catch {
        // Restricted pages and closed tabs remain metadata-only.
      } finally {
        scanned += 1;
        reportProgress();
      }
    }
  };
  await Promise.all(Array.from({ length: SUMMARY_CONCURRENCY }, () => worker()));
  reportProgress(true);
  return finalize(inputs.map((input) => ({ ...input, summary: withSummaries.get(input.tabId) })), withSummaries.size > 0);
}

async function applyGroupProposal(proposal: GroupProposal): Promise<{ groupsCreated: number }> {
  await initialize();
  if (proposal.sourceWindowId == null || !proposal.analyzedTabIds?.length || Date.now() - proposal.createdAt > 5 * 60_000) {
    throw new Error('This project proposal is stale. Run the analysis again.');
  }
  const analyzed = new Set(proposal.analyzedTabIds);
  const seen = new Set<number>();
  const validatedGroups: Array<{ name: string; tabIds: number[] }> = [];
  for (const group of proposal.groups) {
    const name = group.name.trim();
    if (!name || name.length > 42 || group.tabIds.length < 2) throw new Error('The project proposal contains an invalid group.');
    const tabIds = group.tabIds.filter((tabId) => {
      const tab = tabIndex.get(tabId);
      if (!tab || !analyzed.has(tabId) || seen.has(tabId) || tab.windowId !== proposal.sourceWindowId || tab.pinned || tab.groupId !== -1 || (tab.incognito && !settings.incognitoEnabled)) return false;
      seen.add(tabId);
      return true;
    });
    if (tabIds.length !== group.tabIds.length) throw new Error('Some project tabs changed before the proposal was applied.');
    validatedGroups.push({ name, tabIds });
  }
  const changedTabIds = [...seen];
  if (!changedTabIds.length) throw new Error('The proposed tabs are no longer available.');
  const memoryInputs = changedTabIds.map((tabId) => tabIndex.get(tabId)).filter((tab): tab is TabRecord => Boolean(tab && !tab.incognito)).map((tab) => createTabInput(tab));
  const groupedTabIds: number[] = [];
  const createdGroupIds: number[] = [];
  try {
  for (const group of validatedGroups) {
    const tabIds = group.tabIds;
    const groupId = await chrome.tabs.group({ tabIds });
    await chrome.tabGroups.update(groupId, {
      title: group.name,
      color: ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple'][groupId % 8] as chrome.tabGroups.ColorEnum,
      collapsed: false,
    });
    createdGroupIds.push(groupId);
    groupedTabIds.push(...tabIds);
  }
  } catch (error) {
    if (groupedTabIds.length) await chrome.tabs.ungroup(groupedTabIds).catch(() => undefined);
    throw error;
  }
  try {
    projectMemory = buildProjectMemoryRules(memoryInputs, proposal, projectMemory);
    await saveProjectMemory(projectMemory);
    snapshotDirty = true;
  } catch {
    // Grouping remains successful if optional local memory cannot be persisted.
  }
  await persistAction({
    actionId: createId('action'),
    type: 'group',
    createdAt: Date.now(),
    affectedTabIds: changedTabIds,
    restoreData: { group: { kind: 'proposal', ungroupTabIds: changedTabIds, groupIds: createdGroupIds } satisfies GroupUndoData },
    expiresAt: Date.now() + 30_000,
  });
  return { groupsCreated: validatedGroups.length };
}

async function updateGroup(groupId: number, action: 'rename' | 'color' | 'collapse', title?: string, color?: TabGroupRecord['color'], collapsed?: boolean): Promise<{ updated: true }> {
  const group = groupIndex.get(groupId);
  if (!group) throw new Error('That tab group is no longer available.');
  if (action === 'rename') {
    const rawTitle = (title ?? '').trim();
    if (rawTitle.length > 42) throw new Error('Group names must be 42 characters or fewer.');
    await chrome.tabGroups.update(groupId, { title: rawTitle });
  } else if (action === 'color') {
    if (!color) throw new Error('A tab group color is required.');
    await chrome.tabGroups.update(groupId, { color });
  } else {
    await chrome.tabGroups.update(groupId, { collapsed: Boolean(collapsed) });
    return { updated: true };
  }
  await persistAction({
    actionId: createId('action'),
    type: 'group',
    createdAt: Date.now(),
    affectedTabIds: [...tabIndex.values()].filter((tab) => tab.groupId === groupId).map((tab) => tab.tabId),
    restoreData: { group: { kind: 'metadata', groupId, previousTitle: group.title, previousColor: group.color, nextTitle: action === 'rename' ? (title ?? '').trim() : group.title, nextColor: action === 'color' ? color : group.color } satisfies GroupUndoData },
    expiresAt: Date.now() + 30_000,
  });
  return { updated: true };
}

async function ungroupGroup(groupId: number): Promise<{ ungrouped: number }> {
  const group = groupIndex.get(groupId);
  if (!group) throw new Error('That tab group is no longer available.');
  const tabs = [...tabIndex.values()].filter((tab) => tab.groupId === groupId);
  if (!tabs.length) throw new Error('That tab group has no available tabs.');
  await chrome.tabs.ungroup(tabs.map((tab) => tab.tabId));
  await persistAction({
    actionId: createId('action'),
    type: 'group',
    createdAt: Date.now(),
    affectedTabIds: tabs.map((tab) => tab.tabId),
    restoreData: { group: { kind: 'ungroup', tabs: tabs.map((tab) => restoreDescriptorFromTab(tab, group)), groupTitle: group.title, groupColor: group.color, groupCollapsed: group.collapsed } satisfies GroupUndoData },
    expiresAt: Date.now() + 30_000,
  });
  return { ungrouped: tabs.length };
}

async function buildCleanupProposal(windowId: number): Promise<CleanupProposal> {
  pruneCleanupProposals();
  const tabs = [...tabIndex.values()].filter((tab) => tab.windowId === windowId && (settings.incognitoEnabled || !tab.incognito) && !tab.pinned && !tab.active && !tab.audible && !isSpecialUrl(tab.url));
  const inputs = tabs.map((tab) => createTabInput(tab));
  const ruleCandidates = heuristicCleanup(inputs, settings.protectedDomains);
  const aiKey = await hasCloudPermission() ? cloudApiKey : '';
  const aiCandidates = await createAIProvider(settings, aiKey).proposeCleanup(inputs, settings.protectedDomains);
  const rawByTabId = new Map(ruleCandidates.map((candidate) => [candidate.tabId, candidate]));
  aiCandidates.forEach((candidate) => { if (!rawByTabId.has(candidate.tabId)) rawByTabId.set(candidate.tabId, candidate); });
  const raw = [...rawByTabId.values()];
  const pageAccess = await hasPageSafetyPermission();
  const safety = new Map<number, { protected: boolean; evidence: string[] }>();
  if (!pageAccess) {
    raw.forEach((candidate) => safety.set(candidate.tabId, { protected: true, evidence: ['Page safety could not be verified without optional page access.'] }));
  } else {
    let cursor = 0;
    const inspect = async () => {
      while (cursor < raw.length) {
        const candidate = raw[cursor++];
        safety.set(candidate.tabId, await inspectCleanupSafety(candidate.tabId));
      }
    };
    await Promise.all([inspect(), inspect()]);
  }
  const candidates = raw.map((candidate) => {
    const tab = tabIndex.get(candidate.tabId);
    const protectedByLocal = tab ? isCleanupProtectedTab(tab) : true;
    const pageSafety = safety.get(candidate.tabId) ?? { protected: true, evidence: ['Page safety could not be verified.'] };
    return { ...candidate, evidence: [...candidate.evidence, ...pageSafety.evidence], protected: candidate.protected || protectedByLocal || pageSafety.protected };
  });
  const proposal = {
    proposalId: createId('cleanup'),
    candidates,
    createdAt: Date.now(),
    sourceWindowId: windowId,
    analyzedTabIds: tabs.map((tab) => tab.tabId),
    expiresAt: Date.now() + 5 * 60_000,
  };
  cleanupProposals.set(proposal.proposalId, proposal);
  return proposal;
}

function isCleanupProtectedTab(tab: TabRecord): boolean {
  const host = getHostname(tab.url);
  return tab.pinned
    || tab.active
    || tab.audible
    || isSpecialUrl(tab.url)
    || isLocalAddress(tab.url)
    || (tab.incognito && !settings.incognitoEnabled)
    || settings.protectedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function hasPageSafetyPermission(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

async function hasCloudPermission(): Promise<boolean> {
  const origin = hostPermissionForBaseUrl(settings.openaiBaseUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

async function syncAutoDiscardAlarm(): Promise<void> {
  try {
    if (settings.autoDiscardEnabled) await chrome.alarms.create(AUTO_DISCARD_ALARM, { periodInMinutes: 1 });
    else await chrome.alarms.clear(AUTO_DISCARD_ALARM);
  } catch {
    /* alarms permission may be missing in older builds */
  }
}

async function runAutoDiscard(): Promise<void> {
  if (!settings.autoDiscardEnabled) return;
  const now = Date.now();
  const inspectEnabled = settings.autoDiscardInspectPages;
  const hasPermission = inspectEnabled ? await hasPageSafetyPermission() : false;
  for (const tab of tabIndex.values()) {
    if (!shouldAutoDiscard(tab, settings, now)) continue;
    let inspectProtected = true;
    if (inspectEnabled && hasPermission) inspectProtected = (await inspectCleanupSafety(tab.tabId)).protected;
    if (shouldSkipDiscardAfterInspect({ inspectEnabled, hasPermission, inspectProtected })) continue;
    try {
      await chrome.tabs.discard(tab.tabId);
    } catch {
      /* tab may have closed or already been discarded */
    }
  }
}

async function importStashes(incoming: StashRecord[]): Promise<{ imported: number }> {
  let imported = 0;
  for (const stash of incoming) {
    if (!stash.tabs.length) continue;
    await saveStash(stash);
    imported += 1;
  }
  stashesCache = await listStashes();
  return { imported };
}

async function listRecentSessions(): Promise<RecentSession[]> {
  const sessions = await chrome.sessions.getRecentlyClosed({ maxResults: 25 });
  return sessions.flatMap((session): RecentSession[] => {
    const sessionId = session.window?.sessionId ?? session.tab?.sessionId;
    if (!sessionId) return [];
    if (session.window) {
      const tabs = session.window.tabs ?? [];
      const title = session.window.tabs?.find((tab) => tab.active)?.title || tabs[0]?.title || 'Closed window';
      return [{ sessionId, lastModified: session.lastModified ?? 0, title, tabCount: tabs.length, kind: 'window' }];
    }
    return [{ sessionId, lastModified: session.lastModified ?? 0, title: session.tab?.title || session.tab?.url || 'Closed tab', tabCount: 1, kind: 'tab' }];
  });
}

async function inspectCleanupSafety(tabId: number): Promise<{ protected: boolean; evidence: string[] }> {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const dirtyForm = [...document.querySelectorAll('input, textarea, select')].some((element) => {
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value !== element.defaultValue;
          if (element instanceof HTMLSelectElement) return [...element.options].some((option) => option.selected !== option.defaultSelected);
          return false;
        });
        const activeEditor = document.activeElement instanceof HTMLElement
          && (document.activeElement.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName));
        const liveMedia = [...document.querySelectorAll('audio, video')].some((media) => media instanceof HTMLMediaElement && !media.paused && !media.ended);
        const realtimeResource = performance.getEntriesByType('resource').some((entry) => /websocket|socket\.io|sockjs|webrtc/i.test(entry.name));
        return {
          protected: dirtyForm || activeEditor || liveMedia || realtimeResource,
          evidence: [
            ...(dirtyForm ? ['The page contains unsaved form changes.'] : []),
            ...(activeEditor ? ['The page is currently being edited.'] : []),
            ...(liveMedia ? ['Audio or video is currently playing.'] : []),
            ...(realtimeResource ? ['A real-time connection signal was detected.'] : []),
          ],
        };
      },
    });
    const safety = result[0]?.result;
    if (safety && typeof safety === 'object' && 'protected' in safety && 'evidence' in safety) {
      const value = safety as { protected: boolean; evidence: unknown };
      return { protected: Boolean(value.protected), evidence: Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === 'string') : [] };
    }
  } catch {
    // Restricted pages and closed tabs fail closed.
  }
  return { protected: true, evidence: ['Page safety could not be verified.'] };
}

function pruneCleanupProposals(): void {
  const now = Date.now();
  for (const [proposalId, proposal] of cleanupProposals) {
    if (proposal.expiresAt <= now) cleanupProposals.delete(proposalId);
  }
  while (cleanupProposals.size > 8) {
    const oldest = cleanupProposals.keys().next().value;
    if (oldest) cleanupProposals.delete(oldest);
    else break;
  }
}

async function removeTabsReliably(tabIds: number[]): Promise<number[]> {
  const requested = [...new Set(tabIds)];
  if (!requested.length) return [];
  try {
    await chrome.tabs.remove(requested);
    return requested;
  } catch {
    const closed: number[] = [];
    for (const tabId of requested) {
      try {
        await chrome.tabs.get(tabId);
        await chrome.tabs.remove(tabId);
        closed.push(tabId);
      } catch {
        try { await chrome.tabs.get(tabId); } catch { closed.push(tabId); }
      }
    }
    return closed;
  }
}

async function closeTabsWithJournal(tabIds: number[], type: ActionJournal['type']): Promise<number> {
  const tabs = tabIds.map((tabId) => tabIndex.get(tabId)).filter((tab): tab is TabRecord => Boolean(tab && !tab.pinned && !tab.active && (type !== 'cleanup' || !isCleanupProtectedTab(tab))));
  if (!tabs.length) return 0;
  const descriptors = tabs.map((tab) => restoreDescriptorFromTab(tab, tab.groupId !== -1 ? groupIndex.get(tab.groupId) : undefined));
  const closedIds = await removeTabsReliably(tabs.map((tab) => tab.tabId));
  const closed = new Set(closedIds);
  const closedDescriptors = descriptors.filter((descriptor) => closed.has(descriptor.tabId ?? -1));
  if (closedDescriptors.length) {
    await persistAction({
      actionId: createId('action'),
      type,
      createdAt: Date.now(),
      affectedTabIds: closedDescriptors.map((descriptor) => descriptor.tabId ?? -1),
      restoreData: { tabs: closedDescriptors },
      expiresAt: Date.now() + 30_000,
    });
  }
  return closedDescriptors.length;
}

async function windowExists(windowId: number): Promise<boolean> {
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

async function restoreDescriptors(descriptors: TabRestoreDescriptor[], preferredWindowId?: number, focus = false, onProgress?: (completed: number, total: number) => void, incognito = false): Promise<{ created: number; failed: number }> {
  const normalized = descriptors.map((descriptor, index) => ({
    ...descriptor,
    windowId: typeof descriptor.windowId === 'number' ? descriptor.windowId : preferredWindowId ?? -1,
    index: Number.isFinite(descriptor.index) ? descriptor.index : index,
    active: Boolean(descriptor.active),
    pinned: Boolean(descriptor.pinned),
    muted: Boolean(descriptor.muted),
    groupId: typeof descriptor.groupId === 'number' ? descriptor.groupId : -1,
  }));
  const ordered = normalized.filter((descriptor) => descriptor.url && !isSpecialUrl(descriptor.url)).sort((left, right) => left.index - right.index);
  if (!ordered.length) return { created: 0, failed: descriptors.length };
  let targetWindowId = preferredWindowId;
  let createdWindow = false;
  let initialCreatedTabId: number | undefined;
  if (targetWindowId == null || !(await windowExists(targetWindowId))) {
    const first = ordered[0];
    const created = await chrome.windows.create({ url: first.url, focused: focus, incognito });
    if (created.id == null) throw new Error('Could not create a restore window.');
    targetWindowId = created.id;
    createdWindow = true;
    initialCreatedTabId = created.tabs?.[0]?.id ?? (await chrome.tabs.query({ windowId: targetWindowId }))[0]?.id;
  }

  const createdTabs = new Map<number, number>();
  let failed = descriptors.length - ordered.length;
  for (let index = 0; index < ordered.length; index += 1) {
    const descriptor = ordered[index];
    try {
      let createdTabId: number | undefined;
      if (createdWindow && index === 0) {
        createdTabId = initialCreatedTabId;
      }
      if (createdTabId == null) {
        const created = await chrome.tabs.create({ windowId: targetWindowId, url: descriptor.url, index: index, active: false });
        createdTabId = created.id ?? undefined;
      }
      if (createdTabId == null) throw new Error('Chrome did not return a restored tab id.');
      createdTabs.set(descriptor.tabId ?? -(index + 1), createdTabId);
      await chrome.tabs.update(createdTabId, { muted: descriptor.muted, pinned: descriptor.pinned }).catch(() => undefined);
    } catch {
      failed += 1;
    }
    onProgress?.(index + 1, ordered.length);
  }

  const groups = new Map<number, { tabIds: number[]; descriptor: TabRestoreDescriptor }>();
  for (const descriptor of ordered) {
    if (descriptor.groupId === -1 || descriptor.pinned) continue;
    const createdTabId = createdTabs.get(descriptor.tabId ?? -1);
    if (createdTabId == null) continue;
    const group = groups.get(descriptor.groupId) ?? { tabIds: [], descriptor };
    group.tabIds.push(createdTabId);
    groups.set(descriptor.groupId, group);
  }
  for (const group of groups.values()) {
    try {
      const newGroupId = await chrome.tabs.group({ tabIds: group.tabIds });
      await chrome.tabGroups.update(newGroupId, { title: group.descriptor.groupTitle ?? 'Restored project', color: group.descriptor.groupColor ?? 'blue', collapsed: Boolean(group.descriptor.groupCollapsed) });
    } catch {
      failed += group.tabIds.length;
    }
  }

  const active = ordered.find((descriptor) => descriptor.active);
  const activeTabId = active ? createdTabs.get(active.tabId ?? -1) : undefined;
  if (activeTabId != null) {
    await chrome.tabs.update(activeTabId, { active: true }).catch(() => undefined);
    if (focus && targetWindowId != null) await chrome.windows.update(targetWindowId, { focused: true }).catch(() => undefined);
  }
  return { created: createdTabs.size, failed };
}

async function restoreAction(): Promise<boolean> {
  if (!lastAction) return false;
  if (lastAction.expiresAt < Date.now()) {
    await clearLastAction();
    lastAction = undefined;
    return false;
  }
  const data = lastAction.restoreData as { stashId?: string; tabs?: TabRestoreDescriptor[]; ungroupTabIds?: number[]; group?: GroupUndoData; kind?: 'duplicate'; newTab?: TabRestoreDescriptor; candidate?: DuplicateUndoData['candidate']; incognito?: boolean } | undefined;
  if (lastAction.type === 'stash' && data?.tabs?.length) {
    const result = await restoreDescriptors(data.tabs, data.tabs[0].windowId, true, undefined, Boolean(data.incognito));
    if (result.failed > 0) throw new Error('Some stashed tabs could not be restored.');
    if (data.stashId) {
      await deleteStash(data.stashId);
      stashesCache = stashesCache.filter((stash) => stash.id !== data.stashId);
    }
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  if (lastAction.type === 'group' && data?.group?.kind === 'proposal') {
    const allowedGroups = data.group.groupIds?.length ? new Set(data.group.groupIds) : undefined;
    const liveTabIds = data.group.ungroupTabIds.filter((tabId) => {
      const tab = tabIndex.get(tabId);
      return Boolean(tab && tab.groupId !== -1 && (!allowedGroups || allowedGroups.has(tab.groupId)));
    });
    if (!liveTabIds.length) throw new Error('The project groups changed; Undo was skipped.');
    await chrome.tabs.ungroup(liveTabIds);
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  if (lastAction.type === 'group' && data?.ungroupTabIds) {
    const liveTabIds = data.ungroupTabIds.filter((tabId) => tabIndex.get(tabId)?.groupId !== -1);
    if (!liveTabIds.length) throw new Error('The project groups changed; Undo was skipped.');
    await chrome.tabs.ungroup(liveTabIds);
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  if (lastAction.type === 'group' && data?.group?.kind === 'metadata') {
    const group = groupIndex.get(data.group.groupId);
    if (!group) throw new Error('That tab group no longer exists; Undo was skipped.');
    if ((data.group.nextTitle != null && group.title !== data.group.nextTitle) || (data.group.nextColor != null && group.color !== data.group.nextColor)) {
      throw new Error('That tab group changed after the action; Undo was skipped.');
    }
    await chrome.tabGroups.update(data.group.groupId, { title: data.group.previousTitle, color: data.group.previousColor });
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  if (lastAction.type === 'group' && data?.group?.kind === 'ungroup') {
    const descriptors = data.group.tabs.filter((descriptor) => {
      const tabId = descriptor.tabId;
      return typeof tabId === 'number' && tabIndex.get(tabId)?.groupId === -1;
    });
    const liveTabIds = descriptors.map((tab) => tab.tabId).filter((tabId): tabId is number => typeof tabId === 'number');
    if (!liveTabIds.length) throw new Error('The tab group changed; Undo was skipped.');
    const groupId = await chrome.tabs.group({ tabIds: liveTabIds });
    await chrome.tabGroups.update(groupId, { title: data.group.groupTitle, color: data.group.groupColor, collapsed: data.group.groupCollapsed });
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  if (lastAction.type === 'duplicate' && data?.kind === 'duplicate' && data.newTab && data.candidate) {
    const candidate = tabIndex.get(data.candidate.tabId);
    if (candidate && candidate.canonicalUrl === data.candidate.canonicalUrl) {
      const candidateWindowExists = await windowExists(data.candidate.windowId);
      if (candidateWindowExists && candidate.windowId !== data.candidate.windowId) await chrome.tabs.move(candidate.tabId, { windowId: data.candidate.windowId, index: data.candidate.index });
      else if (candidate.windowId === data.candidate.windowId && !candidate.pinned) await chrome.tabs.move(candidate.tabId, { windowId: candidate.windowId, index: data.candidate.index });
      if (data.candidate.groupId !== -1 && !data.candidate.pinned) {
        if (groupIndex.has(data.candidate.groupId)) await chrome.tabs.group({ tabIds: [candidate.tabId], groupId: data.candidate.groupId });
        else if (data.candidate.group) {
          const newGroupId = await chrome.tabs.group({ tabIds: [candidate.tabId] });
          await chrome.tabGroups.update(newGroupId, { title: data.candidate.group.title, color: data.candidate.group.color, collapsed: data.candidate.group.collapsed });
        }
      }
      await chrome.tabs.update(candidate.tabId, { active: data.candidate.active, muted: data.candidate.muted, pinned: data.candidate.pinned });
      if (data.candidate.active) await chrome.windows.update(candidate.windowId, { focused: true });
    }
    const result = await restoreDescriptors([data.newTab], data.newTab.windowId, data.newTab.active);
    if (result.failed > 0) throw new Error('The duplicate tab could not be restored.');
    await clearLastAction();
    lastAction = undefined;
    return true;
  }
  const descriptors = data?.tabs ?? [];
  if (!descriptors.length) return false;
  const result = await restoreDescriptors(descriptors, descriptors[0].windowId, false);
  if (result.created === 0) return false;
  await clearLastAction();
  lastAction = undefined;
  return true;
}

async function stashTabs(windowId: number, scope: 'window' | 'group' | 'tabs', groupId: number | undefined, tabIds: number[] | undefined, includePinned: boolean, includeActive: boolean): Promise<StashRecord> {
  const tabs = await chrome.tabs.query({ windowId });
  if (tabs.some((tab) => tab.incognito) && !settings.incognitoEnabled) throw new Error('Incognito stashing is disabled in Settings.');
  const groups = await chrome.tabGroups.query({ windowId });
  const groupMap = new Map(groups.map((group) => [group.id, group]));
  if (scope === 'group' && (groupId == null || !groupMap.has(groupId))) throw new Error('That tab group is no longer available.');
  if (scope === 'tabs' && !tabIds?.length) throw new Error('No tabs were selected for stashing.');
  const requestedTabIds = new Set(tabIds ?? []);
  const selected = tabs.filter((tab): tab is chrome.tabs.Tab & { id: number } => tab.id != null
    && (scope === 'window' || (scope === 'group' && tab.groupId === groupId) || (scope === 'tabs' && requestedTabIds.has(tab.id)))
    && (includePinned || !tab.pinned)
    && (includeActive || !tab.active)
    && !isSpecialUrl(tab.url));
  if (!selected.length) throw new Error('There are no eligible tabs to stash.');
  const sourceGroup = scope === 'group' && groupId != null ? groupMap.get(groupId) : undefined;
  const stash: StashRecord = {
    version: 1,
    id: createId('stash'),
    name: scope === 'group'
      ? `${sourceGroup?.title || 'Tab group'} · ${selected.length} tabs`
      : `${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${selected[0]?.title?.slice(0, 28) || 'Browser session'}`,
    createdAt: Date.now(),
    sourceWindowId: windowId,
    incognito: Boolean(selected[0]?.incognito),
    scope,
    sourceGroupId: scope === 'group' ? groupId : undefined,
    sourceGroupTitle: sourceGroup?.title,
    activeTabId: tabs.find((tab) => tab.active)?.id,
    tabs: selected.map((tab) => {
      const group = tab.groupId !== -1 ? groupMap.get(tab.groupId) : undefined;
      return {
        tabId: tab.id,
        url: tab.url ?? tab.pendingUrl ?? '',
        title: tab.title ?? 'Untitled tab',
        windowId: tab.windowId,
        favIconUrl: tab.favIconUrl,
        index: tab.index,
        active: Boolean(tab.active),
        pinned: Boolean(tab.pinned),
        muted: Boolean(tab.mutedInfo?.muted),
        groupId: tab.groupId,
        groupTitle: group?.title ?? undefined,
        groupColor: group?.color,
        groupCollapsed: group?.collapsed,
      };
    }),
  };
  await saveStash(stash);
  stashesCache = await listStashes();
  const descriptors = stash.tabs;
  const closedIds = await removeTabsReliably(selected.map((tab) => tab.id));
  const closed = new Set(closedIds);
  const closedDescriptors = descriptors.filter((descriptor) => closed.has(descriptor.tabId ?? -1));
  if (closedDescriptors.length) {
    await persistAction({
      actionId: createId('action'),
      type: 'stash',
      createdAt: Date.now(),
      affectedTabIds: closedDescriptors.map((descriptor) => descriptor.tabId ?? -1),
      restoreData: { stashId: stash.id, tabs: closedDescriptors, incognito: stash.incognito },
      expiresAt: Date.now() + 30_000,
    });
  }
  if (closedDescriptors.length !== selected.length) throw new Error('The stash was saved, but some tabs could not be closed.');
  return stash;
}

async function restoreStash(stashId: string): Promise<{ created: number; failed: number }> {
  const stash = stashesCache.find((item) => item.id === stashId);
  if (!stash) throw new Error('Stash not found.');
  if (stash.incognito && !settings.incognitoEnabled) throw new Error('Incognito restore is disabled in Settings.');
  if (!stash.tabs.length) throw new Error('This stash has no tabs to restore.');
  return restoreDescriptors(stash.tabs, undefined, true, (completed, total) => sendEvent({ type: 'RESTORE_PROGRESS', stashId, completed, total }), stash.incognito);
}

async function restoreStashSelection(stashId: string, selection: { kind: 'tab'; tabId: number } | { kind: 'group'; groupId: number }): Promise<{ created: number; failed: number }> {
  const stash = stashesCache.find((item) => item.id === stashId);
  if (!stash) throw new Error('Stash not found.');
  if (stash.incognito && !settings.incognitoEnabled) throw new Error('Incognito restore is disabled in Settings.');
  const selected = selection.kind === 'tab'
    ? stash.tabs.filter((tab) => tab.tabId === selection.tabId)
    : stash.tabs.filter((tab) => tab.groupId === selection.groupId && selection.groupId !== -1);
  if (!selected.length) throw new Error('That Stash item is no longer available.');
  return restoreDescriptors(selected, undefined, true, (completed, total) => sendEvent({ type: 'RESTORE_PROGRESS', stashId, completed, total }), stash.incognito);
}

async function renameStash(stashId: string, name: string): Promise<StashRecord> {
  const stash = stashesCache.find((item) => item.id === stashId);
  if (!stash) throw new Error('Stash not found.');
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error('Stash names must be between 1 and 80 characters.');
  const renamed = await updateStash(stashId, (current) => ({ ...current, name: trimmed }));
  stashesCache = await listStashes();
  return renamed;
}

async function handleMessage(message: ZenTabMessage): Promise<unknown> {
  await initialize();
  switch (message.type) {
    case 'GET_SNAPSHOT':
      return buildSnapshot();
    case 'RUN_GROUP_ANALYSIS':
      return prepareGroupInputs(message.windowId, Boolean(message.deepScanAll));
    case 'APPLY_GROUP_PROPOSAL':
      return applyGroupProposal(message.proposal);
    case 'RUN_CLEANUP_ANALYSIS':
      return buildCleanupProposal(message.windowId);
    case 'APPLY_CLEANUP': {
      pruneCleanupProposals();
      const proposal = cleanupProposals.get(message.proposalId);
      if (!proposal || proposal.expiresAt <= Date.now()) throw new Error('Cleanup proposal expired.');
      const analyzed = new Set(proposal.analyzedTabIds);
      const candidates = new Map(proposal.candidates.map((candidate) => [candidate.tabId, candidate]));
      const requested = new Set(message.tabIds);
      const eligible: number[] = [];
      let skipped = 0;
      for (const tabId of requested) {
        const candidate = candidates.get(tabId);
        const tab = tabIndex.get(tabId);
        if (!candidate || candidate.protected || !analyzed.has(tabId) || !tab || tab.windowId !== proposal.sourceWindowId || isCleanupProtectedTab(tab)) {
          skipped += 1;
          continue;
        }
        eligible.push(tabId);
      }
      const count = await closeTabsWithJournal(eligible, 'cleanup');
      cleanupProposals.delete(message.proposalId);
      return { closed: count, skipped };
    }
    case 'STASH':
      return stashTabs(message.windowId, message.scope, message.groupId, message.tabIds, Boolean(message.includePinned), Boolean(message.includeActive));
    case 'STASH_WINDOW':
      return stashTabs(message.windowId, 'window', undefined, undefined, Boolean(message.includePinned), Boolean(message.includeActive));
    case 'RESTORE_STASH':
      return restoreStash(message.stashId);
    case 'RESTORE_STASH_SELECTION':
      return restoreStashSelection(message.stashId, message.selection);
    case 'RENAME_STASH':
      return renameStash(message.stashId, message.name);
    case 'DELETE_STASH':
      await deleteStash(message.stashId);
      stashesCache = stashesCache.filter((stash) => stash.id !== message.stashId);
      return { deleted: true };
    case 'UNDO_ACTION':
      return { undone: await restoreAction() };
    case 'CLEAR_PROJECT_MEMORY':
      await clearProjectMemory();
      projectMemory = [];
      return { cleared: true };
    case 'UPDATE_SETTINGS':
      settings = { ...settings, ...message.patch };
      if (message.patch.aiProvider && message.patch.aiProvider !== 'openai-compatible') {
        cloudApiKey = '';
        await saveGroqApiKey('');
      }
      await saveSettings(settings);
      await syncAutoDiscardAlarm();
      return settings;
    case 'UPDATE_CLOUD_KEY':
      if (message.apiKey.length > 512) throw new Error('The API key is too long.');
      cloudApiKey = message.apiKey.trim();
      await saveGroqApiKey(cloudApiKey);
      return { configured: Boolean(cloudApiKey) };
    case 'IMPORT_STASHES':
      return importStashes(message.stashes);
    case 'LIST_RECENT_SESSIONS':
      return listRecentSessions();
    case 'RESTORE_SESSION':
      await chrome.sessions.restore(message.sessionId);
      return { restored: true };
    case 'CLOSE_TABS':
      return { closed: await closeTabsWithJournal([...new Set(message.tabIds)], 'cleanup') };
    case 'MOVE_TAB':
      await chrome.tabs.move(message.tabId, { windowId: message.windowId, index: message.index });
      await refreshWindowTabIndexes(message.windowId);
      return { moved: true };
    case 'GROUP_TAB':
      if (message.groupId !== -1) await chrome.tabs.group({ tabIds: [message.tabId], groupId: message.groupId });
      return { grouped: true };
    case 'UPDATE_GROUP':
      return updateGroup(message.groupId, message.action, message.title, message.color, message.collapsed);
    case 'UNGROUP_GROUP':
      return ungroupGroup(message.groupId);
    case 'UPDATE_TAB':
      if (message.action === 'discard') await chrome.tabs.discard(message.tabId);
      else if (message.action === 'close') return { closed: await closeTabsWithJournal([message.tabId], 'cleanup') };
      else if (message.action === 'activate') {
        const tab = tabIndex.get(message.tabId);
        if (!tab) throw new Error('Tab no longer exists.');
        await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(message.tabId, { active: true });
      }
      else if (message.action === 'mute') await chrome.tabs.update(message.tabId, { muted: true });
      else if (message.action === 'unmute') await chrome.tabs.update(message.tabId, { muted: false });
      else if (message.action === 'pin') await chrome.tabs.update(message.tabId, { pinned: true });
      else if (message.action === 'unpin') await chrome.tabs.update(message.tabId, { pinned: false });
      return { updated: true };
    default:
      return undefined;
  }
}

function isMutationMessage(message: ZenTabMessage): boolean {
  return message.type === 'APPLY_GROUP_PROPOSAL'
    || message.type === 'APPLY_CLEANUP'
    || message.type === 'STASH'
    || message.type === 'STASH_WINDOW'
    || message.type === 'RESTORE_STASH'
    || message.type === 'RESTORE_STASH_SELECTION'
    || message.type === 'RENAME_STASH'
    || message.type === 'DELETE_STASH'
    || message.type === 'UNDO_ACTION'
    || message.type === 'CLEAR_PROJECT_MEMORY'
    || message.type === 'UPDATE_SETTINGS'
    || message.type === 'UPDATE_CLOUD_KEY'
    || message.type === 'IMPORT_STASHES'
    || message.type === 'RESTORE_SESSION'
    || message.type === 'CLOSE_TABS'
    || message.type === 'MOVE_TAB'
    || message.type === 'GROUP_TAB'
    || message.type === 'UPDATE_GROUP'
    || message.type === 'UNGROUP_GROUP'
    || message.type === 'UPDATE_TAB';
}

chrome.runtime.onMessage.addListener((message: ZenTabMessage, _sender, sendResponse) => {
  const task = isMutationMessage(message) ? runMutation(() => handleMessage(message)) : handleMessage(message);
  void task
    .then((response) => {
      scheduleSnapshotBroadcast();
      sendResponse({ ok: true, data: response });
    })
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' }));
  return true;
});

chrome.tabs.onCreated.addListener((tab) => {
  indexTab(asTabRecord(tab));
  scheduleSnapshotBroadcast();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  indexTab(asTabRecord(tab));
  if (changeInfo.url) startupTabIds.delete(tabId);
  if (changeInfo.url || changeInfo.status === 'complete') scheduleDuplicateCheck(tabId);
  scheduleSnapshotBroadcast();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const pending = pendingDuplicateChecks.get(tabId);
  if (pending) clearTimeout(pending);
  pendingDuplicateChecks.delete(tabId);
  removeFromCanonicalIndex(tabIndex.get(tabId));
  tabIndex.delete(tabId);
  creationTimes.delete(tabId);
  startupTabIds.delete(tabId);
  handledDuplicateTabs.delete(tabId);
  scheduleSnapshotBroadcast();
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  const tab = tabIndex.get(tabId);
  if (tab) indexTab({ ...tab, index: moveInfo.toIndex });
  void refreshWindowTabIndexes(moveInfo.windowId);
  scheduleSnapshotBroadcast();
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  const tab = tabIndex.get(tabId);
  if (tab) indexTab({ ...tab, windowId: attachInfo.newWindowId, index: attachInfo.newPosition });
  scheduleSnapshotBroadcast();
});

chrome.tabs.onDetached.addListener((tabId) => {
  const tab = tabIndex.get(tabId);
  if (tab) removeFromCanonicalIndex(tab);
  scheduleSnapshotBroadcast();
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  const old = tabIndex.get(removedTabId);
  removeFromCanonicalIndex(old);
  tabIndex.delete(removedTabId);
  if (old) {
    void chrome.tabs.get(addedTabId).then((tab) => indexTab(asTabRecord(tab))).catch(() => undefined);
  }
  scheduleSnapshotBroadcast();
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const active = tabIndex.get(tabId);
  if (active) {
    for (const tab of tabIndex.values()) {
      if (tab.windowId === active.windowId && tab.active) indexTab({ ...tab, active: false });
    }
    indexTab({ ...active, active: true, lastAccessed: Date.now() });
  }
  scheduleSnapshotBroadcast();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  focusedWindowId = windowId;
  scheduleSnapshotBroadcast();
});

chrome.windows.onRemoved.addListener((windowId) => {
  removeWindowState(windowId);
  if (focusedWindowId === windowId) focusedWindowId = chrome.windows.WINDOW_ID_NONE;
  scheduleSnapshotBroadcast();
});

chrome.tabGroups.onCreated.addListener((group) => {
  groupIndex.set(group.id, tabGroupFromChrome(group));
  scheduleSnapshotBroadcast();
});

chrome.tabGroups.onUpdated.addListener((group) => {
  groupIndex.set(group.id, tabGroupFromChrome(group));
  scheduleSnapshotBroadcast();
});

chrome.tabGroups.onRemoved.addListener((group) => {
  groupIndex.delete(group.id);
  scheduleSnapshotBroadcast();
});

chrome.runtime.onStartup.addListener(() => {
  initialized = false;
  initializing = undefined;
  void initialize();
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_DISCARD_ALARM) return;
  void initialize().then(() => runAutoDiscard()).catch(() => undefined);
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
void initialize();
