import { beforeEach, describe, expect, it } from 'vitest';
import { BookmarkOrganizeSnapshot } from './types';
import {
  BOOKMARK_ORGANIZE_SNAPSHOTS_KEY,
  clearProjectMemory,
  deleteBookmarkOrganizeSnapshot,
  listStashes,
  loadBookmarkOrganizeSnapshots,
  loadProjectMemory,
  loadSettings,
  loadWorkerBootstrap,
  saveBookmarkOrganizeSnapshots,
  saveProjectMemory,
} from './storage';

type MockStorage = Record<string, unknown>;

const storage: MockStorage = {};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => key in storage).map((key) => [key, storage[key]]));
        },
        set: async (value: MockStorage) => Object.assign(storage, value),
        remove: async (key: string) => { delete storage[key]; },
      },
    },
  };
});

describe('storage validation', () => {
  it('defaults atmosphere on and rejects non-boolean values', async () => {
    const unset = await loadSettings();
    expect(unset.atmosphereEnabled).toBe(true);
    storage['zen-tab.settings'] = { atmosphereEnabled: 'no' };
    const invalid = await loadSettings();
    expect(invalid.atmosphereEnabled).toBe(true);
    storage['zen-tab.settings'] = { atmosphereEnabled: false };
    const off = await loadSettings();
    expect(off.atmosphereEnabled).toBe(false);
  });

  it('falls back safely when stored settings have invalid field types', async () => {
    storage['zen-tab.settings'] = {
      language: 'fr',
      protectedDomains: 'not-an-array',
      ignoredDomains: { invalid: true },
      deepAnalysisEnabled: 'yes',
    };
    const settings = await loadSettings();
    expect(settings.language).toBe('en');
    expect(settings.protectedDomains).toContain('figma.com');
    expect(settings.ignoredDomains).toEqual([]);
    expect(settings.deepAnalysisEnabled).toBe(false);
    expect(settings.autoDiscardInspectPages).toBe(false);
  });

  it('migrates groq provider settings to openai-compatible', async () => {
    storage['zen-tab.settings'] = {
      aiProvider: 'groq',
      groqModel: 'llama-3.3-70b-versatile',
    };
    const settings = await loadSettings();
    expect(settings.aiProvider).toBe('openai-compatible');
    expect(settings.openaiModel).toBe('llama-3.3-70b-versatile');
    expect(settings.openaiBaseUrl).toBe('https://api.groq.com/openai/v1');
    expect(settings.autoDiscardEnabled).toBe(false);
  });

  it('filters malformed stashes and migrates missing per-tab restore fields', async () => {
    storage['zen-tab.stashes'] = [
      { version: 1, id: 'valid', name: 'Valid', createdAt: 1, sourceWindowId: 42, tabs: [{ url: 'https://example.com', title: 'Example', index: 0, groupId: -1 }] },
      { version: 1, id: 'invalid', tabs: 'broken' },
    ];
    const stashes = await listStashes();
    expect(stashes).toHaveLength(1);
    expect(stashes[0].tabs[0].windowId).toBe(42);
    expect(stashes[0].tabs[0].active).toBe(false);
  });

  it('falls back safely and bounds normalized project memory', async () => {
    storage['zen-tab.project-memory'] = [
      { id: 'valid', projectName: 'A project', tokens: ['A very long token '.repeat(20), 'shared'], createdAt: 1, updatedAt: 2, useCount: 3 },
      { id: 'invalid', projectName: 'Broken', tokens: 'not-an-array' },
    ];
    const rules = await loadProjectMemory();
    expect(rules).toHaveLength(1);
    expect(rules[0].tokens).toContain('shared');
    expect(rules[0].tokens.every((token) => token.length <= 80)).toBe(true);
  });

  it('reads bootstrap state in one storage get', async () => {
    storage['zen-tab.settings'] = { language: 'zh', theme: 'dark' };
    storage['zen-tab.stashes'] = [
      { version: 1, id: 'valid', name: 'Valid', createdAt: 1, sourceWindowId: 42, tabs: [{ url: 'https://example.com', title: 'Example', index: 0, groupId: -1 }] },
    ];
    storage['zen-tab.project-memory'] = [{ id: 'rule', projectName: 'Work', tokens: ['work'], createdAt: 1, updatedAt: 2, useCount: 1 }];
    storage['zen-tab.groq-key'] = 'sk-test';
    const bootstrap = await loadWorkerBootstrap();
    expect(bootstrap.settings.language).toBe('zh');
    expect(bootstrap.settings.theme).toBe('dark');
    expect(bootstrap.stashes).toHaveLength(1);
    expect(bootstrap.projectMemory[0].projectName).toBe('Work');
    expect(bootstrap.cloudApiKey).toBe('sk-test');
  });

  it('limits project memory rules and can clear them', async () => {
    const rules = Array.from({ length: 120 }, (_, index) => ({
      id: `rule-${index}`,
      projectName: `Project ${index}`,
      tokens: [`project-${index}`, 'context'],
      createdAt: index,
      updatedAt: index,
      useCount: 1,
    }));
    await saveProjectMemory(rules);
    expect((await loadProjectMemory())).toHaveLength(100);
    await clearProjectMemory();
    expect(await loadProjectMemory()).toEqual([]);
  });
});

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function organizeSnapshot(id: string, createdAt: number, extra: Partial<BookmarkOrganizeSnapshot> = {}): BookmarkOrganizeSnapshot {
  return {
    id,
    createdAt,
    expiresAt: createdAt + WEEK_MS,
    moveCount: 1,
    createdFolderIds: [],
    nodes: [{ id: 'n', parentId: '2', index: 0 }],
    ...extra,
  };
}

describe('bookmark organize snapshots', () => {
  it('saves four snapshots and keeps the three newest after prune', async () => {
    const now = Date.now();
    await saveBookmarkOrganizeSnapshots([
      organizeSnapshot('a', now - 3_000),
      organizeSnapshot('b', now - 2_000),
      organizeSnapshot('c', now - 1_000),
      organizeSnapshot('d', now),
    ]);
    const loaded = await loadBookmarkOrganizeSnapshots();
    expect(loaded.map((item) => item.id)).toEqual(['b', 'c', 'd']);
    expect(storage[BOOKMARK_ORGANIZE_SNAPSHOTS_KEY]).toEqual(loaded);
  });

  it('returns no snapshots after saving an expired one', async () => {
    await saveBookmarkOrganizeSnapshots([organizeSnapshot('old', Date.now() - WEEK_MS - 1_000)]);
    expect(await loadBookmarkOrganizeSnapshots()).toEqual([]);
  });

  it('prunes expired leftovers planted on disk at load time', async () => {
    const now = Date.now();
    storage[BOOKMARK_ORGANIZE_SNAPSHOTS_KEY] = [
      organizeSnapshot('old', now - WEEK_MS - 1_000),
      organizeSnapshot('a', now - 3_000),
      organizeSnapshot('b', now - 2_000),
      organizeSnapshot('c', now - 1_000),
      organizeSnapshot('d', now),
    ];
    const loaded = await loadBookmarkOrganizeSnapshots();
    expect(loaded.map((item) => item.id)).toEqual(['b', 'c', 'd']);
  });

  it('drops node title/url and ignores malformed snapshots on load', async () => {
    const now = Date.now();
    storage[BOOKMARK_ORGANIZE_SNAPSHOTS_KEY] = [
      {
        id: 'good',
        createdAt: now,
        expiresAt: now + WEEK_MS,
        moveCount: 2,
        createdFolderIds: ['folder-1'],
        nodes: [{ id: 'n1', parentId: '2', index: 1, title: 'Secret', url: 'https://example.com' }],
      },
      { id: 12, createdAt: now, expiresAt: now + WEEK_MS, nodes: [] },
      { createdAt: now, expiresAt: now + WEEK_MS, nodes: [{ id: 'n', parentId: '2', index: 0 }] },
    ];
    const loaded = await loadBookmarkOrganizeSnapshots();
    expect(loaded).toEqual([{
      id: 'good',
      createdAt: now,
      expiresAt: now + WEEK_MS,
      moveCount: 2,
      createdFolderIds: ['folder-1'],
      nodes: [{ id: 'n1', parentId: '2', index: 1 }],
    }]);
  });

  it('deletes a snapshot by id', async () => {
    const now = Date.now();
    await saveBookmarkOrganizeSnapshots([
      organizeSnapshot('keep', now - 1_000),
      organizeSnapshot('gone', now),
    ]);
    await deleteBookmarkOrganizeSnapshot('gone');
    expect((await loadBookmarkOrganizeSnapshots()).map((item) => item.id)).toEqual(['keep']);
  });
});
