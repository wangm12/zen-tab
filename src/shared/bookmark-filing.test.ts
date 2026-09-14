import { describe, expect, test } from 'vitest';
import {
  NEW_FILING_FOLDER,
  initialFilingFolderId,
  organizeSuggestedMoves,
  resolveFilingMoves,
  resolveFilingRowPlan,
} from './bookmark-filing';
import { BookmarkFolderSuggestion } from './types';

function suggestion(
  patch: Partial<BookmarkFolderSuggestion> & Pick<BookmarkFolderSuggestion, 'confidence'>,
): BookmarkFolderSuggestion {
  return { folderId: 'eng', folderTitle: 'Eng', reason: 'same host', ...patch };
}

describe('initialFilingFolderId', () => {
  const eligible = new Set(['eng', 'docs']);

  test('defaults to empty unless high confidence and eligible', () => {
    expect(initialFilingFolderId(null, eligible)).toBe('');
    expect(initialFilingFolderId(undefined, eligible)).toBe('');
    expect(initialFilingFolderId(suggestion({ confidence: 'medium' }), eligible)).toBe('');
    expect(initialFilingFolderId(suggestion({ confidence: 'low' }), eligible)).toBe('');
    expect(initialFilingFolderId(suggestion({ confidence: 'high', folderId: 'missing' }), eligible)).toBe('');
    expect(initialFilingFolderId(suggestion({ confidence: 'high' }), eligible)).toBe('eng');
  });
});

describe('resolveFilingRowPlan', () => {
  test('uses a new folder only when that destination is chosen', () => {
    expect(resolveFilingRowPlan({
      skipped: false,
      folderId: 'eng',
      newFolderTitle: 'typed by accident',
      newFolderParentId: '2',
    })).toEqual({ type: 'existing', folderId: 'eng' });
    expect(resolveFilingRowPlan({
      skipped: false,
      folderId: NEW_FILING_FOLDER,
      newFolderTitle: 'Docs',
      newFolderParentId: '2',
    })).toEqual({ type: 'create', title: 'Docs', parentId: '2' });
    expect(resolveFilingRowPlan({
      skipped: false,
      folderId: NEW_FILING_FOLDER,
      newFolderTitle: '  ',
      newFolderParentId: '2',
    })).toEqual({ type: 'skip' });
    expect(resolveFilingRowPlan({
      skipped: true,
      folderId: NEW_FILING_FOLDER,
      newFolderTitle: 'Docs',
      newFolderParentId: '2',
    })).toEqual({ type: 'skip' });
  });
});

describe('organizeSuggestedMoves', () => {
  const eligible = new Set(['eng', 'docs']);

  test('files high and medium suggestions into eligible folders', () => {
    expect(organizeSuggestedMoves([
      { bookmarkId: 'a', suggestion: suggestion({ confidence: 'high' }) },
      { bookmarkId: 'b', suggestion: suggestion({ confidence: 'medium', folderId: 'docs', folderTitle: 'Docs' }) },
      { bookmarkId: 'c', suggestion: suggestion({ confidence: 'low' }) },
      { bookmarkId: 'd', suggestion: suggestion({ confidence: 'high', folderId: 'missing' }) },
      { bookmarkId: 'e', suggestion: null },
    ], eligible)).toEqual([
      { bookmarkId: 'a', folderId: 'eng' },
      { bookmarkId: 'b', folderId: 'docs' },
    ]);
  });
});

describe('resolveFilingMoves', () => {
  test('resolves client ids and skips failed creates', () => {
    const clientIds = new Set(['tmp-a', 'tmp-b']);
    const created = new Map([['tmp-a', 'real-a']]);
    expect(resolveFilingMoves([
      { bookmarkId: '1', folderId: 'tmp-a' },
      { bookmarkId: '2', folderId: 'tmp-b' },
      { bookmarkId: '3', folderId: 'eng' },
    ], created, clientIds)).toEqual([
      { bookmarkId: '1', folderId: 'real-a' },
      { bookmarkId: '3', folderId: 'eng' },
    ]);
  });
});
