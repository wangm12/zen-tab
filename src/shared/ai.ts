import { createId } from './ids';
import { extractProjectTokens } from './url';
import {
  AIProvider,
  CleanupCandidate,
  GroupProposal,
  ProjectGroupProposal,
  ProjectTabInput,
  ProviderCapabilities,
  ZenTabSettings,
} from './types';

const GENERIC_TOKENS = new Set([
  'page', 'pages', 'project', 'projects', 'app', 'apps', 'site', 'sites', 'readme', 'repository',
  'issue', 'issues', 'file', 'files', 'document', 'documents', 'view', 'edit', 'copy', 'true', 'false',
]);

type WeightedTokens = Map<string, number>;
const AI_BATCH_SIZE = 40;
const AI_TIMEOUT_MS = 20_000;
const AI_TOTAL_BUDGET_MS = 30_000;

function weightedTokens(input: ProjectTabInput): WeightedTokens {
  const titleTokens = extractProjectTokens({ title: input.title, url: '', summary: '' });
  const urlTokens = extractProjectTokens({ title: '', url: input.url, summary: '' });
  const summaryTokens = extractProjectTokens({ title: '', url: '', summary: input.summary });
  const weights = new Map<string, number>();
  for (const token of titleTokens) weights.set(token, (weights.get(token) ?? 0) + 3);
  for (const token of urlTokens) weights.set(token, (weights.get(token) ?? 0) + 1);
  for (const token of summaryTokens) weights.set(token, (weights.get(token) ?? 0) + 2);
  for (const token of GENERIC_TOKENS) weights.delete(token);
  return weights;
}

function similarity(left: WeightedTokens, right: WeightedTokens): number {
  const all = new Set([...left.keys(), ...right.keys()]);
  let intersection = 0;
  let union = 0;
  for (const token of all) {
    const a = left.get(token) ?? 0;
    const b = right.get(token) ?? 0;
    intersection += Math.min(a, b);
    union += Math.max(a, b);
  }
  return union ? intersection / union : 0;
}

function confidenceFor(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.48) return 'high';
  if (score >= 0.3) return 'medium';
  return 'low';
}

function humanizeToken(token: string): string {
  return token
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function proposalFromHeuristics(input: ProjectTabInput[]): GroupProposal {
  const weighted = input.map(weightedTokens);
  const parents = input.map((_, index) => index);
  const find = (index: number): number => {
    if (parents[index] === index) return index;
    parents[index] = find(parents[index]);
    return parents[index];
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let left = 0; left < input.length; left += 1) {
    for (let right = left + 1; right < input.length; right += 1) {
      const score = similarity(weighted[left], weighted[right]);
      const shared = [...weighted[left].keys()].filter((token) => weighted[right].has(token));
      if (shared.length > 0 && score >= 0.26) union(left, right);
    }
  }

  const clusters = new Map<number, number[]>();
  input.forEach((_, index) => {
    const root = find(index);
    clusters.set(root, [...(clusters.get(root) ?? []), index]);
  });

  const groups: ProjectGroupProposal[] = [];
  const grouped = new Set<number>();

  for (const indices of clusters.values()) {
    if (indices.length < 2) continue;
    const tokenCounts = new Map<string, number>();
    for (const index of indices) {
      for (const [token, weight] of weighted[index]) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + weight);
    }
    const topTokens = [...tokenCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([token]) => token);
    if (!topTokens.length) continue;

    let totalScore = 0;
    let pairCount = 0;
    for (let left = 0; left < indices.length; left += 1) {
      for (let right = left + 1; right < indices.length; right += 1) {
        totalScore += similarity(weighted[indices[left]], weighted[indices[right]]);
        pairCount += 1;
      }
    }
    const score = pairCount ? totalScore / pairCount : 0;
    const confidence = confidenceFor(score);
    if (confidence === 'low') continue;

    indices.forEach((index) => grouped.add(index));
    groups.push({
      name: topTokens.map(humanizeToken).join(' / '),
      tabIds: indices.map((index) => input[index].tabId),
      confidence,
      score,
      evidence: [
        { label: 'Shared context', detail: topTokens.map(humanizeToken).join(', ') },
        { label: 'Cross-site safe', detail: 'Domain was treated as a weak signal, not a grouping boundary.' },
      ],
    });
  }

  return {
    proposalId: createId('proposal'),
    provider: 'local-heuristic',
    groups,
    unclassifiedTabIds: input.filter((_, index) => !grouped.has(index)).map((tab) => tab.tabId),
    analyzedTabCount: input.length,
    createdAt: Date.now(),
  };
}

function parseProposal(raw: unknown, input: ProjectTabInput[], provider: GroupProposal['provider']): GroupProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as { groups?: unknown; unclassifiedTabIds?: unknown };
  const validIds = new Set(input.map((tab) => tab.tabId));
  const used = new Set<number>();
  const groups: ProjectGroupProposal[] = [];

  if (Array.isArray(value.groups)) {
    for (const item of value.groups) {
      if (!item || typeof item !== 'object') continue;
      const group = item as Record<string, unknown>;
      const tabIds = Array.isArray(group.tabIds)
        ? group.tabIds.filter((tabId): tabId is number => typeof tabId === 'number' && validIds.has(tabId) && !used.has(tabId))
        : [];
      if (tabIds.length < 2) continue;
      tabIds.forEach((tabId) => used.add(tabId));
      const rawConfidence = group.confidence;
      const confidence = rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low' ? rawConfidence : 'medium';
      groups.push({
        name: typeof group.name === 'string' && group.name.trim() ? group.name.trim().slice(0, 42) : 'Untitled project',
        tabIds,
        confidence,
        score: typeof group.score === 'number' ? Math.max(0, Math.min(1, group.score)) : confidence === 'high' ? 0.8 : 0.45,
        evidence: Array.isArray(group.evidence)
          ? group.evidence.filter((e): e is { label: string; detail: string } => Boolean(e && typeof e === 'object' && typeof (e as Record<string, unknown>).label === 'string' && typeof (e as Record<string, unknown>).detail === 'string')).slice(0, 4)
          : [{ label: 'AI context', detail: 'Suggested from title, URL, and available page context.' }],
      });
    }
  }

  const explicitUnclassified = Array.isArray(value.unclassifiedTabIds)
    ? value.unclassifiedTabIds.filter((tabId): tabId is number => typeof tabId === 'number' && validIds.has(tabId) && !used.has(tabId))
    : [];
  const unclassified = new Set(explicitUnclassified);
  input.forEach((tab) => {
    if (!used.has(tab.tabId)) unclassified.add(tab.tabId);
  });

  return {
    proposalId: createId('proposal'),
    provider,
    groups,
    unclassifiedTabIds: [...unclassified],
    analyzedTabCount: input.length,
    createdAt: Date.now(),
  };
}

function localModelApi(): { create: (options?: Record<string, unknown>) => Promise<{ prompt: (value: string) => Promise<string>; destroy?: () => void }> } | null {
  const globalObject = globalThis as unknown as {
    LanguageModel?: { create: (options?: Record<string, unknown>) => Promise<{ prompt: (value: string) => Promise<string>; destroy?: () => void }> };
    ai?: { languageModel?: { create: (options?: Record<string, unknown>) => Promise<{ prompt: (value: string) => Promise<string>; destroy?: () => void }> } };
  };
  return globalObject.LanguageModel?.create ? globalObject.LanguageModel : globalObject.ai?.languageModel?.create ? globalObject.ai.languageModel : null;
}

function cleanJsonResult(result: string): unknown {
  return JSON.parse(result.replace(/^```json\s*/i, '').replace(/\s*```$/i, '')) as unknown;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI request timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function batchPrompt(input: ProjectTabInput[]): string {
  return [
    'Group browser tabs into work projects. Do not group by domain alone: the same site can belong to different projects.',
    'Use shared task nouns, repository names, issue IDs, product names, and page context. Keep uncertain tabs unclassified.',
    'Return JSON only: {"groups":[{"name":"...","tabIds":[1,2],"confidence":"high|medium|low","score":0.0,"evidence":[{"label":"...","detail":"..."}]}],"unclassifiedTabIds":[3]}',
    JSON.stringify(input.map(({ tabId, title, url, summary }) => ({ tabId, title, url, summary }))),
  ].join('\n');
}

function cleanupPrompt(input: ProjectTabInput[], protectedDomains: string[]): string {
  return [
    'Identify only browser tabs that are very likely low-value leftovers, such as an older duplicate search page or a completed redirect page.',
    'Never suggest active work, saved edits, meetings, collaboration pages, local development pages, or anything uncertain. Prefer an empty result over a risky result.',
    `Protected domains: ${protectedDomains.join(', ') || 'none'}.`,
    'Return JSON only: {"candidates":[{"tabId":1,"title":"...","url":"...","confidence":"high|medium|low","reason":"...","evidence":["..."]}]}',
    JSON.stringify(input.map(({ tabId, title, url, summary }) => ({ tabId, title, url, summary }))),
  ].join('\n');
}

async function requestLocalJson(prompt: string, systemPrompt = 'You are a precise project-context classifier.'): Promise<unknown | null> {
  const api = localModelApi();
  if (!api) return null;
  let session: Awaited<ReturnType<typeof api.create>> | undefined;

  try {
    session = await api.create({ systemPrompt });
    return cleanJsonResult(await withTimeout(session.prompt(prompt), AI_TIMEOUT_MS));
  } catch {
    return null;
  } finally {
    session?.destroy?.();
  }
}

async function requestLocalModel(input: ProjectTabInput[]): Promise<GroupProposal | null> {
  const raw = await requestLocalJson(batchPrompt(input));
  return raw ? parseProposal(raw, input, 'local-model') : null;
}

async function requestGroqJson(prompt: string, settings: ZenTabSettings, groqApiKey: string, systemPrompt = 'You are a careful browser project classifier.'): Promise<unknown | null> {
  if (!groqApiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.groqModel || 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return cleanJsonResult(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function requestGroq(input: ProjectTabInput[], settings: ZenTabSettings, groqApiKey: string): Promise<GroupProposal | null> {
  const prompt = [
    'Classify these browser tabs into project contexts. Same domains can belong to different projects.',
    'Prefer high precision. Leave ambiguous tabs unclassified. Respond with JSON only using groups, name, tabIds, confidence, score, evidence, and unclassifiedTabIds.',
    batchPrompt(input),
  ].join('\n');
  const raw = await requestGroqJson(prompt, settings, groqApiKey);
  return raw ? parseProposal(raw, input, 'groq') : null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function deterministicMerge(input: ProjectTabInput[], proposals: GroupProposal[], provider: GroupProposal['provider']): GroupProposal {
  const groups: ProjectGroupProposal[] = [];
  const used = new Set<number>();
  for (const proposal of proposals) {
    for (const group of proposal.groups) {
      const groupTokens = new Set(extractProjectTokens({ title: group.name, url: '', summary: '' }));
      const matching = groups.find((existing) => {
        const existingTokens = extractProjectTokens({ title: existing.name, url: '', summary: '' });
        return existingTokens.some((token) => groupTokens.has(token));
      });
      if (matching) {
        matching.tabIds = [...new Set([...matching.tabIds, ...group.tabIds])];
        matching.evidence = [...matching.evidence, ...group.evidence].slice(0, 4);
        matching.score = Math.max(matching.score, group.score);
        if (group.confidence === 'high' || matching.confidence === 'low') matching.confidence = group.confidence;
      } else {
        groups.push({ ...group, tabIds: [...group.tabIds], evidence: [...group.evidence] });
      }
    }
  }
  const validIds = new Set(input.map((tab) => tab.tabId));
  const safeGroups = groups.map((group) => ({ ...group, tabIds: group.tabIds.filter((tabId) => validIds.has(tabId) && !used.has(tabId)) })).filter((group) => group.tabIds.length >= 2);
  safeGroups.forEach((group) => group.tabIds.forEach((tabId) => used.add(tabId)));
  return {
    proposalId: createId('proposal'),
    provider,
    groups: safeGroups,
    unclassifiedTabIds: input.filter((tab) => !used.has(tab.tabId)).map((tab) => tab.tabId),
    analyzedTabCount: input.length,
    createdAt: Date.now(),
  };
}

async function proposeInBatches(input: ProjectTabInput[], mode: 'local-model' | 'groq', settings: ZenTabSettings, groqApiKey: string): Promise<GroupProposal | null> {
  const proposals: GroupProposal[] = [];
  const deadline = Date.now() + AI_TOTAL_BUDGET_MS;
  for (const batch of chunks(input, AI_BATCH_SIZE)) {
    if (Date.now() >= deadline) break;
    const proposal = mode === 'groq' ? await requestGroq(batch, settings, groqApiKey) : await requestLocalModel(batch);
    if (proposal) proposals.push(proposal);
  }
  if (!proposals.length) return null;
  if (proposals.length === 1) {
    const observed = new Set([...proposals[0].groups.flatMap((group) => group.tabIds), ...proposals[0].unclassifiedTabIds]);
    return {
      ...proposals[0],
      analyzedTabCount: input.length,
      unclassifiedTabIds: [...new Set([...proposals[0].unclassifiedTabIds, ...input.filter((tab) => !observed.has(tab.tabId)).map((tab) => tab.tabId)])],
    };
  }

  const candidatePrompt = [
    'Merge candidate browser-tab project groups across batches. Merge only when the project context is clearly the same; otherwise keep groups separate and leave uncertain tabs unclassified.',
    'Return JSON only with groups, tabIds, confidence, score, evidence, and unclassifiedTabIds.',
    JSON.stringify(proposals.flatMap((proposal) => proposal.groups.map((group) => ({ name: group.name, tabIds: group.tabIds, confidence: group.confidence, score: group.score, evidence: group.evidence })))),
  ].join('\n');
  const raw = Date.now() < deadline
    ? mode === 'groq'
      ? await requestGroqJson(candidatePrompt, settings, groqApiKey)
      : await requestLocalJson(candidatePrompt)
    : null;
  if (raw) {
    const merged = parseProposal(raw, input, mode);
    if (merged) return merged;
  }
  return deterministicMerge(input, proposals, mode);
}

function parseCleanupCandidates(raw: unknown, input: ProjectTabInput[], protectedDomains: string[]): CleanupCandidate[] {
  if (!raw || typeof raw !== 'object') return [];
  const value = raw as { candidates?: unknown };
  if (!Array.isArray(value.candidates)) return [];
  const validTabs = new Map(input.map((tab) => [tab.tabId, tab]));
  const seen = new Set<number>();
  const protectedHost = (url: string) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return protectedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return true;
    }
  };
  return value.candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const item = candidate as Record<string, unknown>;
    const tabId = typeof item.tabId === 'number' ? item.tabId : undefined;
    const tab = tabId == null ? undefined : validTabs.get(tabId);
    if (!tab || seen.has(tab.tabId) || protectedHost(tab.url)) return [];
    const confidence = item.confidence === 'high' || item.confidence === 'medium' || item.confidence === 'low' ? item.confidence : 'low';
    const evidence = Array.isArray(item.evidence) ? item.evidence.filter((entry): entry is string => typeof entry === 'string').slice(0, 4) : [];
    const reason = typeof item.reason === 'string' && item.reason.trim() ? item.reason.trim().slice(0, 180) : 'The model identified a possible low-value leftover.';
    seen.add(tab.tabId);
    return [{ tabId: tab.tabId, title: tab.title, url: tab.url, confidence, reason, evidence, protected: false }];
  });
}

async function proposeCleanupInBatches(input: ProjectTabInput[], protectedDomains: string[], mode: 'local-model' | 'groq', settings: ZenTabSettings, groqApiKey: string): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  const deadline = Date.now() + AI_TOTAL_BUDGET_MS;
  for (const batch of chunks(input, AI_BATCH_SIZE)) {
    if (Date.now() >= deadline) break;
    const prompt = cleanupPrompt(batch, protectedDomains);
    const raw = mode === 'groq'
      ? await requestGroqJson(prompt, settings, groqApiKey, 'You are a conservative browser cleanup classifier.')
      : await requestLocalJson(prompt, 'You are a conservative browser cleanup classifier.');
    candidates.push(...parseCleanupCandidates(raw, batch, protectedDomains));
  }
  const seen = new Set<number>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.tabId)) return false;
    seen.add(candidate.tabId);
    return true;
  });
}

export function createAIProvider(settings: ZenTabSettings, groqApiKey = ''): AIProvider {
  const heuristic: AIProvider = {
    async getCapabilities(): Promise<ProviderCapabilities> {
      return { available: true, name: 'heuristic', supportsSummaries: false };
    },
    async proposeProjects(input) {
      return proposalFromHeuristics(input);
    },
    async proposeCleanup(input, protectedDomains) {
      return heuristicCleanup(input, protectedDomains);
    },
    async summarizeTabs() {
      return [];
    },
  };

  return {
    async getCapabilities(): Promise<ProviderCapabilities> {
      const globalObject = globalThis as unknown as { LanguageModel?: unknown; ai?: { languageModel?: unknown } };
      if (settings.aiProvider === 'groq' && groqApiKey) return { available: true, name: 'groq', supportsSummaries: true };
      if (globalObject.LanguageModel || globalObject.ai?.languageModel) return { available: true, name: 'local-model', supportsSummaries: true };
      return heuristic.getCapabilities();
    },
    async proposeProjects(input) {
      if (settings.aiProvider === 'groq' && groqApiKey) {
        const groqProposal = await proposeInBatches(input, 'groq', settings, groqApiKey);
        if (groqProposal) return groqProposal;
      }
      if (localModelApi()) {
        const localProposal = await proposeInBatches(input, 'local-model', settings, groqApiKey);
        if (localProposal) return localProposal;
      }
      return heuristic.proposeProjects(input);
    },
    async proposeCleanup(input, protectedDomains) {
      if (settings.aiProvider === 'groq' && groqApiKey) {
        return proposeCleanupInBatches(input, protectedDomains, 'groq', settings, groqApiKey);
      }
      if (localModelApi()) return proposeCleanupInBatches(input, protectedDomains, 'local-model', settings, groqApiKey);
      return heuristic.proposeCleanup(input, protectedDomains);
    },
    async summarizeTabs() {
      return [];
    },
  };
}

export function heuristicCleanup(input: ProjectTabInput[], protectedDomains: string[]): { tabId: number; title: string; url: string; confidence: 'high' | 'medium' | 'low'; reason: string; evidence: string[]; protected: boolean }[] {
  const searchTabs = new Map<string, ProjectTabInput[]>();
  const candidates: ReturnType<typeof heuristicCleanup> = [];
  for (const tab of input) {
    let parsed: URL | null = null;
    try { parsed = new URL(tab.url); } catch { /* ignore malformed tab URLs */ }
    const host = parsed?.hostname.toLowerCase() ?? '';
    const query = parsed?.searchParams.get('q') ?? parsed?.searchParams.get('query') ?? parsed?.searchParams.get('search_query');
    const isSearch = Boolean(query && /google\.|bing\.|duckduckgo\./.test(host));
    if (isSearch && query) searchTabs.set(`${host}:${query.toLowerCase().trim()}`, [...(searchTabs.get(`${host}:${query.toLowerCase().trim()}`) ?? []), tab]);
    const protectedByDomain = protectedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
    const redirect = /(?:oauth|authorize|callback|login-success|logged-in|redirect)/i.test(tab.url) && !protectedByDomain;
    if (redirect) candidates.push({ tabId: tab.tabId, title: tab.title, url: tab.url, confidence: 'medium', reason: 'Looks like a completed redirect or callback page.', evidence: ['URL pattern matched a known redirect signal.'], protected: false });
  }
  for (const matches of searchTabs.values()) {
    if (matches.length < 2) continue;
    const ordered = [...matches].sort((left, right) => (left.lastAccessed ?? 0) - (right.lastAccessed ?? 0));
    ordered.slice(0, -1).forEach((tab) => candidates.push({ tabId: tab.tabId, title: tab.title, url: tab.url, confidence: 'high', reason: 'An older search page for the same query.', evidence: ['A newer page with the same search query is open.'], protected: false }));
  }
  return candidates;
}
