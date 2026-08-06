import { beforeEach, describe, expect, it } from 'vitest';
import { listStashes, loadSettings } from './storage';

type MockStorage = Record<string, unknown>;

const storage: MockStorage = {};

beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (keys: string[]) => Object.fromEntries(keys.filter((key) => key in storage).map((key) => [key, storage[key]])),
        set: async (value: MockStorage) => Object.assign(storage, value),
        remove: async (key: string) => { delete storage[key]; },
      },
    },
  };
});

describe('storage validation', () => {
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
});
