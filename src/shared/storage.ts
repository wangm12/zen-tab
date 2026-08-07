import {
  ActionJournal,
  DEFAULT_SETTINGS,
  StashRecord,
  StashedTab,
  ProjectMemoryRule,
  ZenTabSettings,
} from './types';

const SETTINGS_KEY = 'zen-tab.settings';
const STASHES_KEY = 'zen-tab.stashes';
const ACTION_KEY = 'zen-tab.last-action';
const GROQ_KEY = 'zen-tab.groq-key';
const LEGACY_SETTINGS_KEY = 'tab-flow.settings';
const LEGACY_STASHES_KEY = 'tab-flow.stashes';
const LEGACY_ACTION_KEY = 'tab-flow.last-action';
const LEGACY_GROQ_KEY = 'tab-flow.groq-key';
const PROJECT_MEMORY_KEY = 'zen-tab.project-memory';
const MAX_PROJECT_MEMORY_RULES = 100;
const MAX_PROJECT_MEMORY_TOKEN_LENGTH = 80;
const MAX_PROJECT_MEMORY_JSON_LENGTH = 1_000_000;

async function readStorageKey<T>(key: string, legacyKey: string): Promise<T | undefined> {
  const result = await chrome.storage.local.get([key, legacyKey]);
  if (result[key] !== undefined) return result[key] as T;
  if (result[legacyKey] !== undefined) {
    await chrome.storage.local.set({ [key]: result[legacyKey] });
    return result[legacyKey] as T;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value.map((item) => item.trim().toLowerCase()).filter(Boolean)
    : fallback;
}

function normalizeStash(value: unknown): StashRecord | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.createdAt !== 'number' || typeof value.sourceWindowId !== 'number' || !Array.isArray(value.tabs)) return null;
  const tabs: StashedTab[] = [];
  for (const rawTab of value.tabs) {
    if (!isRecord(rawTab) || typeof rawTab.url !== 'string' || typeof rawTab.title !== 'string' || typeof rawTab.index !== 'number' || typeof rawTab.groupId !== 'number') return null;
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
  return {
    version: 1,
    id: value.id,
    name: value.name,
    createdAt: value.createdAt,
    sourceWindowId: value.sourceWindowId,
    incognito: Boolean(value.incognito),
    scope: value.scope === 'window' || value.scope === 'group' || value.scope === 'tabs' ? value.scope : undefined,
    sourceGroupId: typeof value.sourceGroupId === 'number' ? value.sourceGroupId : undefined,
    sourceGroupTitle: typeof value.sourceGroupTitle === 'string' ? value.sourceGroupTitle : undefined,
    activeTabId: typeof value.activeTabId === 'number' ? value.activeTabId : undefined,
    tabs,
  };
}

function isActionJournal(value: unknown): value is ActionJournal {
  if (!isRecord(value)) return false;
  return typeof value.actionId === 'string'
    && (value.type === 'duplicate' || value.type === 'group' || value.type === 'cleanup' || value.type === 'stash')
    && typeof value.createdAt === 'number'
    && Array.isArray(value.affectedTabIds)
    && value.affectedTabIds.every((tabId) => typeof tabId === 'number')
    && typeof value.expiresAt === 'number';
}

function normalizeProjectMemory(value: unknown): ProjectMemoryRule[] {
  if (!Array.isArray(value)) return [];
  const rules = value.flatMap((item): ProjectMemoryRule[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.projectName !== 'string' || !Array.isArray(item.tokens)) return [];
    const projectName = item.projectName.trim().slice(0, 80);
    const tokens = [...new Set(item.tokens
      .filter((token): token is string => typeof token === 'string')
      .map((token) => token.trim().toLowerCase().slice(0, MAX_PROJECT_MEMORY_TOKEN_LENGTH))
      .filter(Boolean))].slice(0, 40);
    if (!projectName || !tokens.length) return [];
    return [{
      id: item.id,
      projectName,
      tokens,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      updatedAt: typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
      useCount: typeof item.useCount === 'number' && Number.isFinite(item.useCount) ? Math.max(0, Math.floor(item.useCount)) : 0,
    }];
  });
  return rules.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_PROJECT_MEMORY_RULES);
}

export async function loadSettings(): Promise<ZenTabSettings> {
  const stored = await readStorageKey<unknown>(SETTINGS_KEY, LEGACY_SETTINGS_KEY);
  const safeSettings = isRecord(stored) ? stored : {};
  return {
    ...DEFAULT_SETTINGS,
    duplicateEnabled: typeof safeSettings.duplicateEnabled === 'boolean' ? safeSettings.duplicateEnabled : DEFAULT_SETTINGS.duplicateEnabled,
    duplicateScope: safeSettings.duplicateScope === 'same-window' || safeSettings.duplicateScope === 'all-normal-windows' ? safeSettings.duplicateScope : DEFAULT_SETTINGS.duplicateScope,
    ignoredDomains: stringArray(safeSettings.ignoredDomains, DEFAULT_SETTINGS.ignoredDomains),
    protectedDomains: stringArray(safeSettings.protectedDomains, DEFAULT_SETTINGS.protectedDomains),
    deepAnalysisEnabled: typeof safeSettings.deepAnalysisEnabled === 'boolean' ? safeSettings.deepAnalysisEnabled : DEFAULT_SETTINGS.deepAnalysisEnabled,
    aiProvider: safeSettings.aiProvider === 'groq' ? 'groq' : DEFAULT_SETTINGS.aiProvider,
    groqModel: typeof safeSettings.groqModel === 'string' && safeSettings.groqModel.trim() ? safeSettings.groqModel.trim() : DEFAULT_SETTINGS.groqModel,
    incognitoEnabled: typeof safeSettings.incognitoEnabled === 'boolean' ? safeSettings.incognitoEnabled : DEFAULT_SETTINGS.incognitoEnabled,
    language: safeSettings.language === 'zh' ? 'zh' : 'en',
    theme: safeSettings.theme === 'light' || safeSettings.theme === 'dark' ? safeSettings.theme : 'system',
  };
}

export async function saveSettings(settings: ZenTabSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function loadGroqApiKey(): Promise<string> {
  const value = await readStorageKey<unknown>(GROQ_KEY, LEGACY_GROQ_KEY);
  return typeof value === 'string' ? value : '';
}

export async function saveGroqApiKey(apiKey: string): Promise<void> {
  if (apiKey) await chrome.storage.local.set({ [GROQ_KEY]: apiKey });
  else await chrome.storage.local.remove(GROQ_KEY);
}

export async function listStashes(): Promise<StashRecord[]> {
  const stored = await readStorageKey<unknown>(STASHES_KEY, LEGACY_STASHES_KEY);
  return Array.isArray(stored) ? stored.map(normalizeStash).filter((stash): stash is StashRecord => Boolean(stash)).slice(0, 50) : [];
}

export async function saveStash(stash: StashRecord): Promise<void> {
  const stashes = await listStashes();
  const next = [stash, ...stashes.filter((item) => item.id !== stash.id)].slice(0, 50);
  await chrome.storage.local.set({ [STASHES_KEY]: next });
  const verify = await listStashes();
  if (!verify.some((item) => item.id === stash.id)) throw new Error('Stash could not be persisted.');
}

export async function updateStash(stashId: string, update: (stash: StashRecord) => StashRecord): Promise<StashRecord> {
  const stashes = await listStashes();
  const current = stashes.find((stash) => stash.id === stashId);
  if (!current) throw new Error('Stash not found.');
  const updated = update(current);
  const next = stashes.map((stash) => stash.id === stashId ? updated : stash);
  await chrome.storage.local.set({ [STASHES_KEY]: next });
  const verify = await listStashes();
  const persisted = verify.find((stash) => stash.id === stashId);
  if (!persisted) throw new Error('Stash could not be persisted.');
  return persisted;
}

export async function deleteStash(stashId: string): Promise<void> {
  const stashes = await listStashes();
  await chrome.storage.local.set({ [STASHES_KEY]: stashes.filter((stash) => stash.id !== stashId) });
}

export async function getStash(stashId: string): Promise<StashRecord | undefined> {
  return (await listStashes()).find((stash) => stash.id === stashId);
}

export async function loadProjectMemory(): Promise<ProjectMemoryRule[]> {
  const result = await chrome.storage.local.get(PROJECT_MEMORY_KEY);
  const normalized = normalizeProjectMemory(result[PROJECT_MEMORY_KEY]);
  return JSON.stringify(normalized).length <= MAX_PROJECT_MEMORY_JSON_LENGTH ? normalized : [];
}

export async function saveProjectMemory(rules: ProjectMemoryRule[]): Promise<void> {
  const normalized = normalizeProjectMemory(rules);
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_PROJECT_MEMORY_JSON_LENGTH) throw new Error('Project memory is too large.');
  await chrome.storage.local.set({ [PROJECT_MEMORY_KEY]: normalized });
}

export async function clearProjectMemory(): Promise<void> {
  await chrome.storage.local.remove(PROJECT_MEMORY_KEY);
}

export async function saveLastAction(action: ActionJournal): Promise<void> {
  await chrome.storage.local.set({ [ACTION_KEY]: action });
}

export async function loadLastAction(): Promise<ActionJournal | undefined> {
  const stored = await readStorageKey<unknown>(ACTION_KEY, LEGACY_ACTION_KEY);
  return isActionJournal(stored) ? stored : undefined;
}

export async function clearLastAction(): Promise<void> {
  await chrome.storage.local.remove(ACTION_KEY);
}
