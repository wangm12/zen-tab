import { requestCloudJson, requestLocalJson } from './ai';
import {
  BookmarkOrganizeProposal,
  canOrganizeBookmark,
  clusterHostFromUrl,
  organizeDestinationFolders,
  sanitizeBookmarkTopicProposal,
} from './bookmark-organize';
import { cleanBookmarkTitle } from './bookmark-title';
import { otherBookmarksRootId } from './bookmarks';
import { BookmarkFolderRecord, BookmarkOrganizeScope, BookmarkRecord, Language, ZenTabSettings } from './types';

export const BOOKMARK_ORGANIZE_LOCAL_LIMIT = 35;
export const BOOKMARK_ORGANIZE_CLOUD_LIMIT = 100;
export const BOOKMARK_ORGANIZE_ANALYZE_LIMIT = BOOKMARK_ORGANIZE_LOCAL_LIMIT;

const TOPIC_ORGANIZE_SYSTEM = 'You are a careful bookmark librarian.';

function bookmarkPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function urlChildCounts(bookmarks: BookmarkRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const bookmark of bookmarks) {
    if (!clusterHostFromUrl(bookmark.url)) continue;
    counts.set(bookmark.parentId, (counts.get(bookmark.parentId) ?? 0) + 1);
  }
  return counts;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeParseJsonString(str: string): unknown {
  const direct = safeJsonParse(str);
  if (direct && typeof direct === 'object') return direct;

  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const parsed = safeJsonParse(str.slice(firstBrace, lastBrace + 1));
    if (parsed && typeof parsed === 'object') return parsed;
  }

  const firstBracket = str.indexOf('[');
  const lastBracket = str.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const parsed = safeJsonParse(str.slice(firstBracket, lastBracket + 1));
    if (parsed && typeof parsed === 'object') return parsed;
  }

  return null;
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Check for markdown code fences: ```json ... ``` or ``` ... ```
  const codeBlockMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  for (const match of codeBlockMatches) {
    const parsed = safeParseJsonString(match[1].trim());
    if (parsed && typeof parsed === 'object') return parsed;
  }

  // 2. Parse trimmed string directly or via brace/bracket extraction
  return safeParseJsonString(trimmed);
}

export function selectAnalyzeBookmarks(
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  scope: BookmarkOrganizeScope = 'unfiled',
  limit: number = BOOKMARK_ORGANIZE_LOCAL_LIMIT,
): { eligible: BookmarkRecord[]; analyzed: BookmarkRecord[] } {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const otherRoot = otherBookmarksRootId(folders);
  const barRoot = folders.find((folder) => folder.folderKind === 'bar')?.id ?? '1';
  const childCounts = urlChildCounts(bookmarks);
  const eligible = bookmarks
    .filter((bookmark) => canOrganizeBookmark(bookmark, folders, foldersById, scope))
    .sort((left, right) => {
      const isBarRoot = scope === 'bar' && left.parentId === barRoot;
      const leftPriority = left.isInbox || left.parentId === otherRoot || isBarRoot ? 0 : 1;
      const rightIsBarRoot = scope === 'bar' && right.parentId === barRoot;
      const rightPriority = right.isInbox || right.parentId === otherRoot || rightIsBarRoot ? 0 : 1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      if (leftPriority === 1) {
        const countDiff = (childCounts.get(right.parentId) ?? 0) - (childCounts.get(left.parentId) ?? 0);
        if (countDiff) return countDiff;
      }
      return left.id.localeCompare(right.id);
    });
  const max = typeof limit === 'number' && limit > 0 ? limit : BOOKMARK_ORGANIZE_LOCAL_LIMIT;
  return { eligible, analyzed: eligible.slice(0, max) };
}

export function buildTopicAnalyzePayload(
  analyzed: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  language: Language,
  scope: BookmarkOrganizeScope = 'unfiled',
): {
  language: Language;
  folders: Array<{ id: string; title: string; folderPath: string }>;
  bookmarks: Array<{ id: string; title: string; host: string; path: string; folderId: string; folderTitle: string }>;
} {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  return {
    language,
    folders: organizeDestinationFolders(folders, scope).map((folder) => ({
      id: folder.id,
      title: folder.title,
      folderPath: folder.folderPath || folder.title,
    })),
    bookmarks: analyzed.map((bookmark) => ({
      id: bookmark.id,
      title: cleanBookmarkTitle(bookmark.title, bookmark.url) || bookmark.title,
      host: clusterHostFromUrl(bookmark.url),
      path: bookmarkPath(bookmark.url),
      folderId: bookmark.parentId,
      folderTitle: foldersById.get(bookmark.parentId)?.title ?? '',
    })),
  };
}

export function parseTopicOrganizeJson(raw: unknown): Array<{ name: string; bookmarkIds: string[]; folderId?: string }> {
  const parsedRoot = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsedRoot || typeof parsedRoot !== 'object') return [];
  const groupsRaw = Array.isArray(parsedRoot)
    ? parsedRoot
    : (parsedRoot as { groups?: unknown }).groups;
  if (!Array.isArray(groupsRaw)) return [];
  const groups: Array<{ name: string; bookmarkIds: string[]; folderId?: string }> = [];
  for (const item of groupsRaw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { name?: unknown; bookmarkIds?: unknown; folderId?: unknown };
    if (typeof record.name !== 'string' || !Array.isArray(record.bookmarkIds)) continue;
    const trimmedName = record.name.trim();
    if (!trimmedName) continue;
    const bookmarkIds = record.bookmarkIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()));
    if (!bookmarkIds.length) continue;
    const parsed: { name: string; bookmarkIds: string[]; folderId?: string } = {
      name: trimmedName,
      bookmarkIds,
    };
    if (typeof record.folderId === 'string' && record.folderId.trim().length > 0) {
      parsed.folderId = record.folderId.trim();
    }
    groups.push(parsed);
  }
  return groups;
}

export function topicProposalFromModel(
  raw: unknown,
  bookmarks: BookmarkRecord[],
  folders: BookmarkFolderRecord[],
  scope: BookmarkOrganizeScope = 'unfiled',
): BookmarkOrganizeProposal {
  return sanitizeBookmarkTopicProposal({ groups: parseTopicOrganizeJson(raw) }, bookmarks, folders, scope);
}

export function topicOrganizePrompt(payload: ReturnType<typeof buildTopicAnalyzePayload>): string {
  const instructions = payload.language === 'zh'
    ? [
        '你是一个细致的书签分类整理专家。请将给出的书签按主题分类到文件夹中。',
        '规则与要求：',
        '1. 优先复用已有文件夹：仔细对照已有文件夹的层级路径（folderPath）。如果书签与现有某个文件夹主题契合，必须指定其已有的 folderId，且 name 与该文件夹名称保持一致。',
        '2. 仅在现有文件夹无法涵盖时才建议新文件夹（不填 folderId，提供简洁明确的中文主题 name）。',
        '3. 文件夹名称严禁使用 "Inbox"、"未分类" 等宽泛无意义的名字。',
        '4. 每个组必须包含 name 和匹配的书签 bookmarkIds 数组。建议新建文件夹至少归类 2 个书签。',
        '5. 严格只输出纯 JSON 对象，不要包含任何前言、总结或解释文字。格式：{"groups":[{"name":"...","bookmarkIds":["..."],"folderId":"..."}]}',
      ]
    : [
        'You are a meticulous bookmark librarian. Classify the provided bookmarks into topic folders.',
        'Rules and guidelines:',
        '1. Prioritize existing folders: Examine existing folder taxonomy paths (folderPath). If a bookmark fits an existing category, you MUST set its existing folderId, with name matching that folder.',
        '2. Only create new folders when existing folders are unsuitable (omit folderId, provide a clear concise topic name).',
        '3. Folder names must be descriptive and concise. Never use "Inbox", "Unfiled", or generic placeholders.',
        '4. Each group must contain "name" and matching "bookmarkIds". New folders should contain at least 2 bookmarks.',
        '5. Output STRICT JSON ONLY. Do NOT include any conversational filler, explanation, or preamble. Format: {"groups":[{"name":"...","bookmarkIds":["..."],"folderId":"..."}]}',
      ];
  return [...instructions, JSON.stringify({ folders: payload.folders, bookmarks: payload.bookmarks })].join('\n');
}

export async function requestTopicOrganizeJson(
  payload: ReturnType<typeof buildTopicAnalyzePayload>,
  mode: 'local-model' | 'openai-compatible',
  settings: ZenTabSettings,
  apiKey: string,
): Promise<unknown | null> {
  const prompt = topicOrganizePrompt(payload);
  if (mode === 'local-model') return requestLocalJson(prompt, TOPIC_ORGANIZE_SYSTEM);
  return requestCloudJson(prompt, settings, apiKey, TOPIC_ORGANIZE_SYSTEM);
}
