import { describe, expect, it } from 'vitest';
import { applyProjectMemory, batchPrompt, buildProjectMemoryRules, cloudProposalForSidePanel, createAIProvider, deterministicMerge, downloadProgressPercent, ensureBuiltInLanguageModel, heuristicCleanup } from './ai';
import { DEFAULT_SETTINGS, GroupProposal, ProjectMemoryRule, ProjectTabInput } from './types';

const input: ProjectTabInput[] = [
  { tabId: 1, title: 'Zen Tab performance plan', url: 'https://docs.google.com/document/d/abc', canonicalUrl: 'https://docs.google.com/document/d/abc' },
  { tabId: 2, title: 'Zen Tab issue 42', url: 'https://github.com/acme/zen-tab/issues/42', canonicalUrl: 'https://github.com/acme/zen-tab/issues/42' },
  { tabId: 3, title: 'Travel booking options', url: 'https://www.example.com/travel/booking', canonicalUrl: 'https://www.example.com/travel/booking' },
];

describe('project grouping fallback', () => {
  const emptyProposal = (tabIds: number[]): GroupProposal => ({
    proposalId: 'proposal-test',
    provider: 'local-heuristic',
    groups: [],
    unclassifiedTabIds: tabIds,
    analyzedTabCount: tabIds.length,
    createdAt: Date.now(),
  });

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

  it('uses confirmed local project memory as a high-confidence grouping signal', () => {
    const memory: ProjectMemoryRule[] = [{ id: 'memory-1', projectName: 'Zen Tab', tokens: ['zen', 'tab'], createdAt: 1, updatedAt: 2, useCount: 1 }];
    const proposal = applyProjectMemory(input, emptyProposal(input.map((tab) => tab.tabId)), memory);
    expect(proposal.groups).toHaveLength(1);
    expect(proposal.groups[0].name).toBe('Zen Tab');
    expect(proposal.groups[0].confidence).toBe('high');
    expect(proposal.groups[0].tabIds).toEqual([1, 2]);
    expect(proposal.unclassifiedTabIds).toContain(3);
  });

  it('keeps conflicting memory rules unclassified instead of merging them', () => {
    const memory: ProjectMemoryRule[] = [
      { id: 'memory-1', projectName: 'Zen Tab', tokens: ['zen', 'tab'], createdAt: 1, updatedAt: 2, useCount: 1 },
      { id: 'memory-2', projectName: 'Tab Research', tokens: ['tab', 'research'], createdAt: 1, updatedAt: 3, useCount: 1 },
    ];
    const conflictInput = [
      { tabId: 1, title: 'Zen Tab research', url: 'https://docs.example.com/zen-tab', canonicalUrl: null },
      { tabId: 2, title: 'Zen Tab research notes', url: 'https://github.com/acme/zen-tab', canonicalUrl: null },
    ];
    const proposal = applyProjectMemory(conflictInput, emptyProposal([1, 2]), memory);
    expect(proposal.groups).toHaveLength(0);
    expect(proposal.unclassifiedTabIds).toEqual([1, 2]);
  });

  it('does not learn a single-tab project or unclassified tabs', () => {
    const memory = buildProjectMemoryRules(input, emptyProposal(input.map((tab) => tab.tabId)), []);
    expect(memory).toEqual([]);
    const grouped: GroupProposal = {
      ...emptyProposal([3]),
      groups: [{ name: 'Travel', tabIds: [3], confidence: 'high', score: 0.8, evidence: [] }],
    };
    expect(buildProjectMemoryRules(input, grouped, [])).toEqual([]);
  });

  it('does not group unrelated pages that only share a product host', async () => {
    const provider = createAIProvider(DEFAULT_SETTINGS);
    const proposal = await provider.proposeProjects([
      { tabId: 1, title: 'Q3 hiring plan', url: 'https://www.notion.so/hiring-plan', canonicalUrl: null },
      { tabId: 2, title: 'Kitchen remodel notes', url: 'https://www.notion.so/kitchen-remodel', canonicalUrl: null },
    ]);
    expect(proposal.groups).toHaveLength(0);
    expect(proposal.unclassifiedTabIds).toEqual([1, 2]);
  });

  it('names heuristic groups from project words instead of the site', async () => {
    const provider = createAIProvider(DEFAULT_SETTINGS);
    const proposal = await provider.proposeProjects(input);
    const zenGroup = proposal.groups.find((group) => group.tabIds.includes(1) && group.tabIds.includes(2));
    expect(zenGroup?.name.toLowerCase()).toMatch(/zen/);
    expect(zenGroup?.name.toLowerCase()).not.toMatch(/google|github/);
    expect(zenGroup?.evidence.some((item) => /zen|tab|shared/i.test(`${item.label} ${item.detail}`))).toBe(true);
  });

  it('adds remaining memory-matched tabs into an overlapping group', () => {
    const memory: ProjectMemoryRule[] = [{ id: 'memory-1', projectName: 'Zen Tab', tokens: ['zen', 'tab'], createdAt: 1, updatedAt: 2, useCount: 1 }];
    const partial: GroupProposal = {
      ...emptyProposal([3]),
      groups: [{ name: 'Zen work', tabIds: [1, 2], confidence: 'medium', score: 0.4, evidence: [] }],
      unclassifiedTabIds: [3],
      analyzedTabCount: 3,
    };
    const memoryInput: ProjectTabInput[] = [
      ...input.slice(0, 2),
      { tabId: 4, title: 'Zen Tab design review', url: 'https://www.figma.com/file/zen-tab', canonicalUrl: null },
    ];
    partial.unclassifiedTabIds = [4];
    partial.analyzedTabCount = 3;
    const proposal = applyProjectMemory(memoryInput, { ...partial, unclassifiedTabIds: [4], analyzedTabCount: 3 }, memory);
    expect(proposal.groups).toHaveLength(1);
    expect(proposal.groups[0].tabIds).toEqual(expect.arrayContaining([1, 2, 4]));
  });
});

describe('built-in model download progress', () => {
  it('treats Chrome Prompt API loaded fractions and byte totals as a 0-100 percent', () => {
    expect(downloadProgressPercent(0.42)).toBe(42);
    expect(downloadProgressPercent(1)).toBe(100);
    expect(downloadProgressPercent(512, 1024)).toBe(50);
    expect(downloadProgressPercent(2, 0)).toBe(2);
  });

  it('reports downloadprogress from LanguageModel.create monitor', async () => {
    const original = (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
    const percents: number[] = [];
    (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      create: async (options?: { monitor?: (monitor: { addEventListener: (type: string, listener: (event: { loaded: number }) => void) => void }) => void }) => {
        options?.monitor?.({
          addEventListener(_type, listener) {
            listener({ loaded: 0.25 });
            listener({ loaded: 1 });
          },
        });
        return { prompt: async () => '', destroy: () => undefined };
      },
    };
    try {
      const session = await ensureBuiltInLanguageModel((percent) => percents.push(percent));
      expect(percents).toEqual([25, 100]);
      session.destroy?.();
    } finally {
      (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = original;
    }
  });

  it('forwards an abort signal into LanguageModel.create', async () => {
    const original = (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel;
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = {
      create: async (options?: { signal?: AbortSignal }) => {
        received = options?.signal;
        return { prompt: async () => '', destroy: () => undefined };
      },
    };
    try {
      await ensureBuiltInLanguageModel(undefined, controller.signal);
      expect(received).toBe(controller.signal);
    } finally {
      (globalThis as unknown as { LanguageModel?: unknown }).LanguageModel = original;
    }
  });
});

describe('grouping prompt and merge helpers', () => {
  it('describes tabs as title, host, path, and summary, and follows the UI language', () => {
    const english = batchPrompt(input, 'en');
    expect(english).toMatch(/host/i);
    expect(english).toMatch(/path/i);
    expect(english).toMatch(/docs\.google\.com/);
    expect(english).not.toMatch(/不要按网站/);
    const chinese = batchPrompt(input, 'zh');
    expect(chinese).toMatch(/不要按网站|按项目|未分类/);
  });

  it('merges batch groups only when they share two name tokens', () => {
    const left: GroupProposal = {
      proposalId: 'a',
      provider: 'local-model',
      groups: [{ name: 'Zen Tab', tabIds: [1, 2], confidence: 'high', score: 0.8, evidence: [] }],
      unclassifiedTabIds: [],
      analyzedTabCount: 2,
      createdAt: 1,
    };
    const sticky: GroupProposal = {
      proposalId: 'b',
      provider: 'local-model',
      groups: [{ name: 'New Tab', tabIds: [3, 4], confidence: 'medium', score: 0.5, evidence: [] }],
      unclassifiedTabIds: [],
      analyzedTabCount: 2,
      createdAt: 1,
    };
    const same: GroupProposal = {
      proposalId: 'c',
      provider: 'local-model',
      groups: [{ name: 'Zen Tab notes', tabIds: [5, 6], confidence: 'high', score: 0.7, evidence: [] }],
      unclassifiedTabIds: [],
      analyzedTabCount: 2,
      createdAt: 1,
    };
    const tabs: ProjectTabInput[] = [1, 2, 3, 4, 5, 6].map((tabId) => ({ tabId, title: `Tab ${tabId}`, url: `https://example.com/${tabId}`, canonicalUrl: null }));
    const keptSeparate = deterministicMerge(tabs, [left, sticky], 'local-model');
    expect(keptSeparate.groups).toHaveLength(2);
    const merged = deterministicMerge(tabs, [left, same], 'local-model');
    expect(merged.groups).toHaveLength(1);
    expect(merged.groups[0].tabIds).toEqual(expect.arrayContaining([1, 2, 5, 6]));
  });

  it('only sends a cloud-backed proposal to the side panel', () => {
    const heuristic: GroupProposal = {
      proposalId: 'h',
      provider: 'local-heuristic',
      groups: [],
      unclassifiedTabIds: [1],
      analyzedTabCount: 1,
      createdAt: 1,
    };
    const cloud: GroupProposal = { ...heuristic, provider: 'openai-compatible' };
    expect(cloudProposalForSidePanel(heuristic)).toBeUndefined();
    expect(cloudProposalForSidePanel(cloud)).toBe(cloud);
  });
});
