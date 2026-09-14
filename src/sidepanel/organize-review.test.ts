import { describe, expect, it } from 'vitest';
import { createTranslator } from './i18n';
import {
  canOrganizeBookmark,
  organizeDestinationFolders,
  proposeBookmarkOrganize,
} from '../shared/bookmark-organize';
import { BookmarkFolderRecord, BookmarkOrganizeScope, BookmarkRecord } from '../shared/types';

describe('Phase 4: Organize Review UI & Scope Selector', () => {
  describe('i18n translations', () => {
    it('provides correct English and Chinese translations for scope keys', () => {
      const en = createTranslator('en');
      const zh = createTranslator('zh');

      expect(en('organizeScopeUnfiled')).toBe('Unfiled (Recommended)');
      expect(zh('organizeScopeUnfiled')).toBe('未归类（推荐）');

      expect(en('organizeScopeBar')).toBe('Bookmarks bar');
      expect(zh('organizeScopeBar')).toBe('书签栏');

      expect(en('organizeScopeOther')).toBe('Other bookmarks');
      expect(zh('organizeScopeOther')).toBe('其他书签');

      expect(en('organizeScopeAll')).toBe('All bookmarks');
      expect(zh('organizeScopeAll')).toBe('全部书签');

      expect(en('organizeScopeLabel')).toBe('Scope');
      expect(zh('organizeScopeLabel')).toBe('整理范围');

      expect(en('organizeTargetFolder')).toBe('Target folder');
      expect(zh('organizeTargetFolder')).toBe('目标文件夹');

      expect(en('organizeNewFolderLabel', { name: 'DevTools' })).toBe('New: DevTools');
      expect(zh('organizeNewFolderLabel', { name: '开发工具' })).toBe('新建：开发工具');

      expect(en('organizeIncludedCount', { count: 5 })).toBe('Apply 5 selected');
      expect(zh('organizeIncludedCount', { count: 5 })).toBe('应用选中的 5 项整理');

      expect(en('organizeCandidateCount', { count: 12 })).toBe('12 candidate bookmarks');
      expect(zh('organizeCandidateCount', { count: 12 })).toBe('12 个待整理书签');
    });
  });

  describe('scope candidate filtering & dynamic proposals', () => {
    const folders: BookmarkFolderRecord[] = [
      { id: '1', parentId: '0', title: 'Bookmarks bar', folderPath: 'Bookmarks bar', folderKind: 'bar', isSpecialRoot: true, isBookmarksBar: true, isInbox: false, index: 0 },
      { id: '2', parentId: '0', title: 'Other bookmarks', folderPath: 'Other bookmarks', folderKind: 'other', isSpecialRoot: true, isBookmarksBar: false, isInbox: false, index: 1 },
      { id: 'f-bar-sub', parentId: '1', title: 'Tech', folderPath: 'Bookmarks bar / Tech', folderKind: 'bar', isSpecialRoot: false, isBookmarksBar: true, isInbox: false, index: 0 },
      { id: 'f-other-sub', parentId: '2', title: 'Reading', folderPath: 'Other bookmarks / Reading', folderKind: 'other', isSpecialRoot: false, isBookmarksBar: false, isInbox: false, index: 0 },
    ];

    const bookmarks: BookmarkRecord[] = [
      // Direct root unfiled bookmarks
      { id: 'b-bar-root-1', parentId: '1', title: 'GH 1', url: 'https://github.com/org/repo1', folderPath: 'Bookmarks bar', folderKind: 'bar', isBookmarksBar: true, isInbox: false, index: 1 },
      { id: 'b-bar-root-2', parentId: '1', title: 'GH 2', url: 'https://github.com/org/repo2', folderPath: 'Bookmarks bar', folderKind: 'bar', isBookmarksBar: true, isInbox: false, index: 2 },
      { id: 'b-other-root-1', parentId: '2', title: 'MDN 1', url: 'https://developer.mozilla.org/1', folderPath: 'Other bookmarks', folderKind: 'other', isBookmarksBar: false, isInbox: false, index: 1 },
      { id: 'b-other-root-2', parentId: '2', title: 'MDN 2', url: 'https://developer.mozilla.org/2', folderPath: 'Other bookmarks', folderKind: 'other', isBookmarksBar: false, isInbox: false, index: 2 },
      // Filed in subfolders
      { id: 'b-bar-filed-1', parentId: 'f-bar-sub', title: 'GH 3', url: 'https://github.com/org/repo3', folderPath: 'Bookmarks bar / Tech', folderKind: 'bar', isBookmarksBar: true, isInbox: false, index: 0 },
      { id: 'b-other-filed-1', parentId: 'f-other-sub', title: 'MDN 3', url: 'https://developer.mozilla.org/3', folderPath: 'Other bookmarks / Reading', folderKind: 'other', isBookmarksBar: false, isInbox: false, index: 0 },
    ];

    it('filters candidate bookmarks correctly per scope', () => {
      const foldersById = new Map(folders.map((f) => [f.id, f]));

      const candidatesFor = (scope: BookmarkOrganizeScope) =>
        bookmarks.filter((b) => canOrganizeBookmark(b, folders, foldersById, scope)).map((b) => b.id);

      // 'unfiled' only targets root/inbox bookmarks
      expect(candidatesFor('unfiled')).toEqual([
        'b-bar-root-1',
        'b-bar-root-2',
        'b-other-root-1',
        'b-other-root-2',
      ]);

      // 'bar' targets all bar bookmarks (root + subfolder)
      expect(candidatesFor('bar')).toEqual([
        'b-bar-root-1',
        'b-bar-root-2',
        'b-bar-filed-1',
      ]);

      // 'other' targets all other bookmarks (root + subfolder)
      expect(candidatesFor('other')).toEqual([
        'b-other-root-1',
        'b-other-root-2',
        'b-other-filed-1',
      ]);

      // 'all' targets all valid bookmarks across bar and other
      expect(candidatesFor('all')).toHaveLength(6);
    });

    it('calculates dynamic proposals with scope and destination folders', () => {
      const unfiledProposal = proposeBookmarkOrganize({ bookmarks, folders, scope: 'unfiled' });
      expect(unfiledProposal.clusters.length).toBeGreaterThan(0);

      const destinationsBar = organizeDestinationFolders(folders, 'bar');
      expect(destinationsBar.some((f) => f.id === 'f-bar-sub')).toBe(true);

      const destinationsUnfiled = organizeDestinationFolders(folders, 'unfiled');
      expect(destinationsUnfiled.some((f) => f.id === 'f-bar-sub')).toBe(true);
      expect(destinationsUnfiled.some((f) => f.id === 'f-other-sub')).toBe(true);
    });

    it('simulates interactive exclusions and destination overrides on a proposal', () => {
      const proposal = proposeBookmarkOrganize({ bookmarks, folders, scope: 'unfiled' });
      const firstCluster = proposal.clusters[0];
      expect(firstCluster).toBeDefined();

      // Exclude one bookmark
      const excludedBookmarkIds = new Set([firstCluster.bookmarkIds[0]]);
      const activeIds = firstCluster.bookmarkIds.filter((id) => !excludedBookmarkIds.has(id));
      expect(activeIds.length).toBe(firstCluster.bookmarkIds.length - 1);

      // Target override to an existing destination folder
      const clusterTargetOverrides = new Map<string, string>();
      clusterTargetOverrides.set(firstCluster.key, 'f-other-sub');

      const target = clusterTargetOverrides.get(firstCluster.key);
      expect(target).toBe('f-other-sub');
    });
  });
});
