import { BookmarkForestNode } from './bookmark-tree';

export const COLLAPSED_BOOKMARK_FOLDERS_KEY = 'zen-tab.collapsed-bookmark-folders';
export const LARGE_FOLDER_COLLAPSE_COUNT = 16;

export function readCollapsedFolderIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return value;
}

export function resolveCollapsedFolderIds(stored: unknown, largeFolderIds: string[]): string[] {
  return readCollapsedFolderIds(stored) ?? largeFolderIds;
}

export function toggleCollapsedFolderId(ids: ReadonlySet<string>, folderId: string): string[] {
  const next = new Set(ids);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  return [...next];
}

export function largeFolderIdsToCollapse(
  forest: BookmarkForestNode[],
  threshold = LARGE_FOLDER_COLLAPSE_COUNT,
): string[] {
  const ids: string[] = [];
  const walk = (nodes: BookmarkForestNode[]) => {
    for (const node of nodes) {
      if (node.kind !== 'folder') continue;
      if (node.count >= threshold) ids.push(node.folder.id);
      walk(node.children);
    }
  };
  walk(forest);
  return ids;
}
