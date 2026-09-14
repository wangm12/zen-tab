import { canonicalizeUrl } from './url';
import {
  ActionJournal,
  DEFAULT_SETTINGS,
  GroupColor,
  ProjectMemoryRule,
  StashRecord,
  TabGroupRecord,
  TabRecord,
  WindowSnapshot,
  ZenTabSettings,
  ZenTabSnapshot,
} from './types';

export type ChromeTabInput = {
  id?: number;
  windowId: number;
  incognito?: boolean;
  url?: string;
  pendingUrl?: string;
  title?: string;
  favIconUrl?: string;
  groupId?: number;
  pinned?: boolean;
  active?: boolean;
  audible?: boolean;
  discarded?: boolean;
  autoDiscardable?: boolean;
  mutedInfo?: { muted?: boolean };
  index: number;
  status?: chrome.tabs.Tab['status'];
  lastAccessed?: number;
};

export type ChromeGroupInput = {
  id: number;
  windowId: number;
  title?: string;
  color: GroupColor;
  collapsed?: boolean;
};

export function tabRecordFromChrome(tab: ChromeTabInput, existingCreatedAt?: number, now = Date.now()): TabRecord {
  if (tab.id == null) throw new Error('Chrome returned a tab without an id.');
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    incognito: Boolean(tab.incognito),
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
    createdAt: existingCreatedAt ?? now,
  };
}

export function groupRecordFromChrome(group: ChromeGroupInput): TabGroupRecord {
  return {
    groupId: group.id,
    windowId: group.windowId,
    title: group.title ?? '',
    color: group.color,
    collapsed: Boolean(group.collapsed),
  };
}

export function emptySnapshot(): ZenTabSnapshot {
  return {
    windows: [],
    stashes: [],
    projectMemory: [],
    settings: DEFAULT_SETTINGS,
    hasCloudApiKey: false,
  };
}

export function snapshotFromChromeWindow(input: {
  windowId: number;
  incognito: boolean;
  tabs: ChromeTabInput[];
  groups: ChromeGroupInput[];
  settings: ZenTabSettings;
  stashes?: StashRecord[];
  projectMemory?: ProjectMemoryRule[];
  hasCloudApiKey?: boolean;
  lastAction?: ActionJournal;
  now?: number;
}): ZenTabSnapshot {
  const now = input.now ?? Date.now();
  const tabs = input.tabs.flatMap((tab) => {
    try {
      return [tabRecordFromChrome(tab, undefined, now)];
    } catch {
      return [];
    }
  }).sort((left, right) => left.index - right.index);
  const windowSnapshot: WindowSnapshot = {
    windowId: input.windowId,
    focused: true,
    incognito: input.incognito,
    tabs,
    groups: input.groups.map(groupRecordFromChrome),
  };
  return {
    windows: [windowSnapshot],
    stashes: input.stashes ?? [],
    projectMemory: input.projectMemory ?? [],
    settings: input.settings,
    hasCloudApiKey: Boolean(input.hasCloudApiKey),
    lastAction: input.lastAction,
  };
}
