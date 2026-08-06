import { describe, expect, it } from 'vitest';
import { createAIProvider, heuristicCleanup } from './ai';
import { DEFAULT_SETTINGS, ProjectTabInput } from './types';

const input: ProjectTabInput[] = [
  { tabId: 1, title: 'Zen Tab performance plan', url: 'https://docs.google.com/document/d/abc', canonicalUrl: 'https://docs.google.com/document/d/abc' },
  { tabId: 2, title: 'Zen Tab issue 42', url: 'https://github.com/acme/zen-tab/issues/42', canonicalUrl: 'https://github.com/acme/zen-tab/issues/42' },
  { tabId: 3, title: 'Travel booking options', url: 'https://www.example.com/travel/booking', canonicalUrl: 'https://www.example.com/travel/booking' },
];

describe('project grouping fallback', () => {
  it('groups related work across different domains and leaves unrelated work alone', async () => {
    const provider = createAIProvider(DEFAULT_SETTINGS);
    const proposal = await provider.proposeProjects(input);
    const groupedIds = proposal.groups.flatMap((group) => group.tabIds);
    expect(groupedIds).toEqual(expect.arrayContaining([1, 2]));
    expect(groupedIds).not.toContain(3);
    expect(proposal.unclassifiedTabIds).toContain(3);
  });

  it('never emits a group with fewer than two tabs', async () => {
    const provider = createAIProvider(DEFAULT_SETTINGS);
    const proposal = await provider.proposeProjects([input[2]]);
    expect(proposal.groups).toHaveLength(0);
    expect(proposal.unclassifiedTabIds).toEqual([3]);
  });

  it('rejects unknown model tab ids instead of applying them', async () => {
    const original = (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
    (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      create: async () => ({
        prompt: async () => JSON.stringify({
          groups: [{ name: 'Unsafe', tabIds: [1, 999], confidence: 'high', score: 1 }],
          unclassifiedTabIds: [],
        }),
      }),
    };
    try {
      const proposal = await createAIProvider(DEFAULT_SETTINGS).proposeProjects(input);
      expect(proposal.groups).toHaveLength(0);
      expect(proposal.unclassifiedTabIds).toEqual([1, 2, 3]);
    } finally {
      (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = original;
    }
  });

  it('handles a 300-tab analysis within a bounded local pass', async () => {
    const largeInput: ProjectTabInput[] = Array.from({ length: 300 }, (_, index) => {
      const isFlow = index % 2 === 0;
      return {
        tabId: index + 1,
        title: isFlow ? `Zen Tab performance note ${index}` : `Travel planning note ${index}`,
        url: isFlow ? `https://docs.example.com/flow/${index}` : `https://search.example.com/travel/${index}`,
        canonicalUrl: isFlow ? `https://docs.example.com/flow/${index}` : `https://search.example.com/travel/${index}`,
      };
    });
    const started = performance.now();
    const proposal = await createAIProvider(DEFAULT_SETTINGS).proposeProjects(largeInput);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(proposal.analyzedTabCount).toBe(300);
  });

  it('closes older duplicate search pages based on last access time', () => {
    const candidates = heuristicCleanup([
      { tabId: 10, title: 'Search result', url: 'https://www.google.com/search?q=zen-tab', canonicalUrl: 'https://www.google.com/search?q=zen-tab', lastAccessed: 10 },
      { tabId: 11, title: 'Search result', url: 'https://www.google.com/search?q=zen-tab', canonicalUrl: 'https://www.google.com/search?q=zen-tab', lastAccessed: 20 },
    ], []);
    expect(candidates.map((candidate) => candidate.tabId)).toEqual([10]);
  });

  it('keeps model calls bounded to batches and destroys each local session', async () => {
    const original = (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
    let creates = 0;
    let destroys = 0;
    (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      create: async () => {
        creates += 1;
        return {
          prompt: async () => JSON.stringify({ groups: [], unclassifiedTabIds: [] }),
          destroy: () => { destroys += 1; },
        };
      },
    };
    try {
      const largeInput = Array.from({ length: 81 }, (_, index) => ({ ...input[0], tabId: index + 1, title: `Project note ${index}` }));
      const proposal = await createAIProvider(DEFAULT_SETTINGS).proposeProjects(largeInput);
      expect(proposal.analyzedTabCount).toBe(81);
      expect(creates).toBe(4);
      expect(destroys).toBe(4);
    } finally {
      (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = original;
    }
  });
});
