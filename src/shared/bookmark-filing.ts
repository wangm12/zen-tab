import { BookmarkFolderSuggestion } from './types';

export type BookmarkFilingCreate = { clientId: string; parentId: string; title: string };
export type BookmarkFilingMove = { bookmarkId: string; folderId: string };
export const NEW_FILING_FOLDER = '__new__';

export function resolveFilingRowPlan(draft: {
  skipped: boolean;
  folderId: string;
  newFolderTitle: string;
  newFolderParentId: string;
}): { type: 'skip' } | { type: 'existing'; folderId: string } | { type: 'create'; title: string; parentId: string } {
  if (draft.skipped) return { type: 'skip' };
  if (draft.folderId === NEW_FILING_FOLDER) {
    const title = draft.newFolderTitle.trim();
    if (!title || !draft.newFolderParentId) return { type: 'skip' };
    return { type: 'create', title, parentId: draft.newFolderParentId };
  }
  if (draft.folderId) return { type: 'existing', folderId: draft.folderId };
  return { type: 'skip' };
}

export function initialFilingFolderId(
  suggestion: BookmarkFolderSuggestion | null | undefined,
  eligibleIds: ReadonlySet<string>,
): string {
  if (suggestion?.confidence !== 'high') return '';
  return eligibleIds.has(suggestion.folderId) ? suggestion.folderId : '';
}

export function organizeSuggestedMoves(
  rows: Array<{ bookmarkId: string; suggestion: BookmarkFolderSuggestion | null }>,
  eligibleIds: ReadonlySet<string>,
): BookmarkFilingMove[] {
  const moves: BookmarkFilingMove[] = [];
  for (const row of rows) {
    const suggestion = row.suggestion;
    if (!suggestion || suggestion.confidence === 'low') continue;
    if (!eligibleIds.has(suggestion.folderId)) continue;
    moves.push({ bookmarkId: row.bookmarkId, folderId: suggestion.folderId });
  }
  return moves;
}

export function resolveFilingMoves(
  moves: BookmarkFilingMove[],
  createdByClientId: Map<string, string>,
  clientIds: Set<string>,
): BookmarkFilingMove[] {
  const resolved: BookmarkFilingMove[] = [];
  for (const move of moves) {
    if (!clientIds.has(move.folderId)) {
      resolved.push(move);
      continue;
    }
    const realId = createdByClientId.get(move.folderId);
    if (!realId) continue;
    resolved.push({ ...move, folderId: realId });
  }
  return resolved;
}
