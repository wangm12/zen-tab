import { describe, expect, test } from 'vitest';
import {
  largeFolderIdsToCollapse,
  resolveCollapsedFolderIds,
  toggleCollapsedFolderId,
} from './bookmark-collapse';
import { BookmarkForestNode } from './bookmark-tree';

describe('resolveCollapsedFolderIds', () => {
  test('uses stored ids and does not re-seed', () => {
    expect(resolveCollapsedFolderIds(['keep-open-bar'], ['bar', 'eng'])).toEqual(['keep-open-bar']);
    expect(resolveCollapsedFolderIds([], ['bar'])).toEqual([]);
  });

  test('seeds large folders when nothing is stored', () => {
    expect(resolveCollapsedFolderIds(undefined, ['bar', 'eng'])).toEqual(['bar', 'eng']);
    expect(resolveCollapsedFolderIds(null, ['bar'])).toEqual(['bar']);
    expect(resolveCollapsedFolderIds({ not: 'array' }, ['bar'])).toEqual(['bar']);
  });
});

describe('toggleCollapsedFolderId', () => {
  test('adds and removes a folder id', () => {
    expect(toggleCollapsedFolderId(new Set(['bar']), 'eng').sort()).toEqual(['bar', 'eng']);
    expect(toggleCollapsedFolderId(new Set(['bar', 'eng']), 'bar')).toEqual(['eng']);
  });
});

describe('largeFolderIdsToCollapse', () => {
  test('collects folders at or above the threshold', () => {
    const forest: BookmarkForestNode[] = [{
      kind: 'folder',
      folder: {
        id: 'bar',
        title: 'Bar',
        folderPath: 'Bar',
        isInbox: false,
        isSpecialRoot: true,
        isBookmarksBar: true,
        folderKind: 'bar',
        index: 0,
      },
      count: 20,
      children: [{
        kind: 'folder',
        folder: {
          id: 'tiny',
          parentId: 'bar',
          title: 'Tiny',
          folderPath: 'Bar / Tiny',
          isInbox: false,
          isSpecialRoot: false,
          isBookmarksBar: false,
          folderKind: 'folder',
          index: 0,
        },
        count: 2,
        children: [],
      }],
    }];
    expect(largeFolderIdsToCollapse(forest, 16)).toEqual(['bar']);
  });
});
