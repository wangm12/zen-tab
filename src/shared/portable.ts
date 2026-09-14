import { createId } from './ids';
import { StashRecord, StashedTab, WindowSnapshot } from './types';

export const ZEN_TAB_EXPORT_KIND = 'zen-tab-stashes';
export const ZEN_TAB_EXPORT_VERSION = 1 as const;

export type OneTabEntry = {
  url: string;
  title: string;
};

export type ZenTabExport = {
  kind: typeof ZEN_TAB_EXPORT_KIND;
  version: typeof ZEN_TAB_EXPORT_VERSION;
  exportedAt: number;
  stashes: StashRecord[];
};

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneStash(stash: StashRecord, id = stash.id): StashRecord {
  return {
    ...stash,
    id,
    tabs: stash.tabs.map((tab) => ({ ...tab })),
  };
}

export function exportStashAsJson(stash: StashRecord, exportedAt = Date.now()): string {
  const payload: ZenTabExport = {
    kind: ZEN_TAB_EXPORT_KIND,
    version: ZEN_TAB_EXPORT_VERSION,
    exportedAt,
    stashes: [cloneStash(stash)],
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function exportStashesAsJson(stashes: StashRecord[], exportedAt = Date.now()): string {
  const payload: ZenTabExport = {
    kind: ZEN_TAB_EXPORT_KIND,
    version: ZEN_TAB_EXPORT_VERSION,
    exportedAt,
    stashes: stashes.map((stash) => cloneStash(stash)),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function exportStashAsMarkdown(stash: StashRecord): string {
  const groups = new Map<string, StashedTab[]>();
  const ungrouped: StashedTab[] = [];
  for (const tab of stash.tabs) {
    if (tab.groupId === -1) ungrouped.push(tab);
    else {
      const key = tab.groupTitle?.trim() || 'Untitled group';
      groups.set(key, [...(groups.get(key) ?? []), tab]);
    }
  }
  const lines = [`# ${stash.name}`, ''];
  for (const [name, tabs] of groups) {
    lines.push(`## ${name}`, '');
    for (const tab of tabs) lines.push(`- [${tab.title || tab.url}](${tab.url})`);
    lines.push('');
  }
  if (ungrouped.length) {
    lines.push('## Ungrouped', '');
    for (const tab of ungrouped) lines.push(`- [${tab.title || tab.url}](${tab.url})`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export function parseOneTabText(text: string): OneTabEntry[] {
  const entries: OneTabEntry[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const [maybeUrl, ...rest] = line.split('|').map((part) => part.trim());
    if (!isHttpUrl(maybeUrl)) continue;
    entries.push({ url: maybeUrl, title: rest.join(' | ') || maybeUrl });
  }
  return entries;
}

export function stashFromOneTabEntries(entries: OneTabEntry[], options: { now: number; name: string }): StashRecord {
  const tabs: StashedTab[] = entries.map((entry, index) => ({
    url: entry.url,
    title: entry.title,
    windowId: -1,
    index,
    active: false,
    pinned: false,
    muted: false,
    groupId: -1,
  }));
  return {
    version: 1,
    id: createId('stash'),
    name: options.name.trim() || 'OneTab import',
    createdAt: options.now,
    sourceWindowId: -1,
    incognito: false,
    scope: 'tabs',
    tabs,
  };
}

function stashFromUnknown(value: unknown): StashRecord | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.createdAt !== 'number' || typeof value.sourceWindowId !== 'number' || !Array.isArray(value.tabs)) return null;
  const tabs: StashedTab[] = [];
  for (const rawTab of value.tabs) {
    if (!isRecord(rawTab) || typeof rawTab.url !== 'string' || !isHttpUrl(rawTab.url) || typeof rawTab.title !== 'string' || typeof rawTab.index !== 'number' || typeof rawTab.groupId !== 'number') return null;
    tabs.push({
      tabId: typeof rawTab.tabId === 'number' ? rawTab.tabId : undefined,
      url: rawTab.url,
      title: rawTab.title,
      windowId: typeof rawTab.windowId === 'number' ? rawTab.windowId : value.sourceWindowId,
      favIconUrl: typeof rawTab.favIconUrl === 'string' ? rawTab.favIconUrl : undefined,
      index: rawTab.index,
      active: Boolean(rawTab.active),
      pinned: Boolean(rawTab.pinned),
      muted: Boolean(rawTab.muted),
      groupId: rawTab.groupId,
      groupTitle: typeof rawTab.groupTitle === 'string' ? rawTab.groupTitle : undefined,
      groupColor: typeof rawTab.groupColor === 'string' ? rawTab.groupColor as StashedTab['groupColor'] : undefined,
      groupCollapsed: typeof rawTab.groupCollapsed === 'boolean' ? rawTab.groupCollapsed : undefined,
    });
  }
  if (!tabs.length) return null;
  return {
    version: 1,
    id: createId('stash'),
    name: value.name.trim().slice(0, 80) || 'Imported stash',
    createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    sourceWindowId: value.sourceWindowId,
    incognito: Boolean(value.incognito),
    scope: value.scope === 'window' || value.scope === 'group' || value.scope === 'tabs' ? value.scope : 'tabs',
    sourceGroupId: typeof value.sourceGroupId === 'number' ? value.sourceGroupId : undefined,
    sourceGroupTitle: typeof value.sourceGroupTitle === 'string' ? value.sourceGroupTitle : undefined,
    activeTabId: typeof value.activeTabId === 'number' ? value.activeTabId : undefined,
    tabs,
  };
}

export function parseImportedStashes(raw: string): StashRecord[] {
  const parsed = JSON.parse(raw) as unknown;
  const values = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && parsed.kind === ZEN_TAB_EXPORT_KIND && Array.isArray(parsed.stashes)
      ? parsed.stashes
      : isRecord(parsed)
        ? [parsed]
        : [];
  const stashes = values.map(stashFromUnknown).filter((stash): stash is StashRecord => Boolean(stash));
  if (!stashes.length) throw new Error('No valid Zen Tab stashes were found in that file.');
  return stashes;
}

export function windowToStash(windowSnapshot: WindowSnapshot, options: { now: number; name: string }): StashRecord {
  const groups = new Map(windowSnapshot.groups.map((group) => [group.groupId, group]));
  return {
    version: 1,
    id: createId('stash'),
    name: options.name,
    createdAt: options.now,
    sourceWindowId: windowSnapshot.windowId,
    incognito: windowSnapshot.incognito,
    scope: 'window',
    tabs: windowSnapshot.tabs.map((tab) => {
      const group = groups.get(tab.groupId);
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
    }),
  };
}

export function exportWindowAsJson(windowSnapshot: WindowSnapshot, options: { now: number; name: string }): string {
  return exportStashAsJson(windowToStash(windowSnapshot, options), options.now);
}

export function downloadTextFile(filename: string, contents: string, mime = 'application/json'): void {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
