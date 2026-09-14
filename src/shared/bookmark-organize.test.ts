import { describe, expect, test } from 'vitest';
import { flattenBookmarkTree } from './bookmarks';
import {
  canOrganizeBookmark,
  commitInsertedOrganizeSnapshot,
  constrainOrganizePlan,
  finalizeOrganizeSnapshot,
  folderTitleFromHost,
  insertOrganizeSnapshot,
  mergeTopicWithHostOrganize,
  organizeApplyFinalizeInput,
  organizeDestinationFolders,
  planBookmarkOrganizeRestore,
  proposeBookmarkOrganize,
  pruneBookmarkOrganizeSnapshots,
  sanitizeBookmarkTopicProposal,
  visibleBookmarkOrganizeSnapshots,
} from './bookmark-organize';
import { BookmarkOrganizeScope, BookmarkOrganizeSnapshot } from './types';

type Node = chrome.bookmarks.BookmarkTreeNode & {
  folderType?: 'bookmarks-bar' | 'other' | 'mobile' | 'managed';
  unmodifiable?: 'managed';
  children?: Node[];
};

function tree(
  otherChildren: Node[],
  barChildren: Node[] = [],
  extraRoots: Node[] = [],
  mobileChildren: Node[] = [],
): Node[] {
  return [{
    id: '0',
    title: '',
    children: [
      { id: '1', parentId: '0', title: 'Bookmarks Bar', folderType: 'bookmarks-bar', children: barChildren },
      { id: '2', parentId: '0', title: 'Other Bookmarks', folderType: 'other', children: otherChildren },
      { id: '3', parentId: '0', title: 'Mobile Bookmarks', folderType: 'mobile', children: mobileChildren },
      ...extraRoots,
    ],
  }];
}

function page(id: string, url: string, parentId: string, title = id): Node {
  return { id, parentId, title, url };
}

function organizeFrom(
  otherChildren: Node[],
  barChildren: Node[] = [],
  extraRoots: Node[] = [],
  mobileChildren: Node[] = [],
  scope: BookmarkOrganizeScope = 'other',
) {
  return proposeBookmarkOrganize({
    ...flattenBookmarkTree(tree(otherChildren, barChildren, extraRoots, mobileChildren)),
    scope,
  });
}

describe('folderTitleFromHost', () => {
  test('uses curated brand names and formats site labels', () => {
    expect(folderTitleFromHost('github.com')).toBe('GitHub');
    expect(folderTitleFromHost('www.figma.com')).toBe('Figma');
    expect(folderTitleFromHost('docs.google.com')).toBe('Google');
    expect(folderTitleFromHost('juejin.cn')).toBe('掘金');
    expect(folderTitleFromHost('excalidraw.com')).toBe('Excalidraw');
  });
});

describe('proposeBookmarkOrganize', () => {
  test('suggests new site folders for bookmarks mixed in one dump folder', () => {
    const proposal = organizeFrom([{
      id: 'proj',
      parentId: '2',
      title: 'Interesting Projects',
      children: [
        page('g1', 'https://github.com/acme/one', 'proj', 'One'),
        page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
        page('g3', 'https://www.github.com/acme/three', 'proj', 'Three'),
        page('f1', 'https://www.figma.com/file/aaa', 'proj', 'Board A'),
        page('f2', 'https://figma.com/file/bbb', 'proj', 'Board B'),
        page('solo', 'https://random.example/only', 'proj', 'Only'),
      ],
    }]);

    expect(proposal.creates.map((create) => create.title).sort()).toEqual(['Figma', 'GitHub']);
    expect(proposal.creates.every((create) => create.parentId === '2')).toBe(true);

    const github = proposal.creates.find((create) => create.title === 'GitHub');
    const figma = proposal.creates.find((create) => create.title === 'Figma');
    expect(github && figma).toBeTruthy();
    expect(proposal.moves.filter((move) => move.folderId === github?.clientId).map((move) => move.bookmarkId).sort())
      .toEqual(['g1', 'g2', 'g3']);
    expect(proposal.moves.filter((move) => move.folderId === figma?.clientId).map((move) => move.bookmarkId).sort())
      .toEqual(['f1', 'f2']);
    expect(proposal.moves.some((move) => move.bookmarkId === 'solo')).toBe(false);
  });

  test('files scattered bookmarks into an existing matching folder', () => {
    const proposal = organizeFrom([
      {
        id: 'github',
        parentId: '2',
        title: 'Github',
        children: [page('g0', 'https://github.com/acme/home', 'github', 'Home')],
      },
      {
        id: 'proj',
        parentId: '2',
        title: 'Interesting Projects',
        children: [
          page('g1', 'https://github.com/acme/one', 'proj', 'One'),
          page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
        ],
      },
    ]);

    expect(proposal.creates).toEqual([]);
    expect(proposal.moves).toEqual([
      { bookmarkId: 'g1', folderId: 'github' },
      { bookmarkId: 'g2', folderId: 'github' },
    ]);
  });

  test('does not move bookmarks that are already in a matching folder', () => {
    const proposal = organizeFrom([{
      id: 'github',
      parentId: '2',
      title: 'Github',
      children: [
        page('g1', 'https://github.com/acme/one', 'github'),
        page('g2', 'https://github.com/acme/two', 'github'),
        page('g3', 'https://github.com/acme/three', 'github'),
      ],
    }]);

    expect(proposal).toEqual({ creates: [], moves: [], clusters: [] });
  });

  test('creates a folder for loose Other Bookmarks pages from the same site', () => {
    const proposal = organizeFrom([
      page('g1', 'https://github.com/acme/one', '2', 'One'),
      page('g2', 'https://github.com/acme/two', '2', 'Two'),
    ]);

    expect(proposal.creates).toEqual([
      expect.objectContaining({ parentId: '2', title: 'GitHub' }),
    ]);
    expect(proposal.moves.map((move) => move.bookmarkId).sort()).toEqual(['g1', 'g2']);
    expect(proposal.moves.every((move) => move.folderId === proposal.creates[0]?.clientId)).toBe(true);
  });

  test('reuses a folder that is already mostly that site even if the name does not match', () => {
    const proposal = organizeFrom([
      {
        id: 'stuff',
        parentId: '2',
        title: 'Stuff',
        children: [
          page('g1', 'https://github.com/acme/one', 'stuff'),
          page('g2', 'https://github.com/acme/two', 'stuff'),
          page('g3', 'https://github.com/acme/three', 'stuff'),
          page('g4', 'https://github.com/acme/four', 'stuff'),
          page('g5', 'https://github.com/acme/five', 'stuff'),
          page('other', 'https://notes.example/page', 'stuff'),
        ],
      },
      page('loose', 'https://github.com/acme/loose', '2', 'Loose'),
    ]);

    expect(proposal.creates).toEqual([]);
    expect(proposal.moves).toEqual([{ bookmarkId: 'loose', folderId: 'stuff' }]);
  });

  test('files a single bookmark into an existing name-matching folder', () => {
    const proposal = organizeFrom([
      { id: 'figma', parentId: '2', title: 'Figma', children: [] },
      {
        id: 'proj',
        parentId: '2',
        title: 'Interesting Projects',
        children: [page('f1', 'https://figma.com/file/aaa', 'proj', 'Board')],
      },
    ]);

    expect(proposal.creates).toEqual([]);
    expect(proposal.moves).toEqual([{ bookmarkId: 'f1', folderId: 'figma' }]);
  });

  test('ignores singleton sites, bar shortcuts, mobile, and managed bookmarks', () => {
    const proposal = organizeFrom(
      [
        {
          id: 'proj',
          parentId: '2',
          title: 'Interesting Projects',
          children: [page('solo', 'https://lonely.example/page', 'proj')],
        },
        page('inbox-solo', 'https://unique.example/page', '2'),
      ],
      [
        page('bar1', 'https://github.com/acme/bar-one', '1'),
        page('bar2', 'https://github.com/acme/bar-two', '1'),
      ],
      [{
        id: '99',
        parentId: '0',
        title: 'Managed',
        folderType: 'managed',
        unmodifiable: 'managed',
        children: [
          page('m1', 'https://github.com/acme/managed-one', '99'),
          page('m2', 'https://github.com/acme/managed-two', '99'),
        ],
      }],
    );

    expect(proposal).toEqual({ creates: [], moves: [], clusters: [] });
  });

  test('does not organize nested Bookmarks Bar folders', () => {
    const proposal = organizeFrom([], [{
      id: 'work',
      parentId: '1',
      title: 'Work',
      children: [
        page('g1', 'https://github.com/acme/one', 'work'),
        page('g2', 'https://github.com/acme/two', 'work'),
      ],
    }]);
    expect(proposal).toEqual({ creates: [], moves: [], clusters: [] });
  });

  test('does not move nested bar bookmarks into Other matching folders', () => {
    const proposal = organizeFrom(
      [{
        id: 'github',
        parentId: '2',
        title: 'Github',
        children: [],
      }],
      [{
        id: 'work',
        parentId: '1',
        title: 'Work',
        children: [
          page('g1', 'https://github.com/acme/one', 'work'),
          page('g2', 'https://github.com/acme/two', 'work'),
        ],
      }],
    );
    expect(proposal).toEqual({ creates: [], moves: [], clusters: [] });
  });

  test('does not use Bookmarks Bar folders as organize destinations', () => {
    const proposal = organizeFrom(
      [
        page('g1', 'https://github.com/acme/one', '2', 'One'),
        page('g2', 'https://github.com/acme/two', '2', 'Two'),
      ],
      [{
        id: 'github-bar',
        parentId: '1',
        title: 'Github',
        children: [],
      }],
    );
    expect(proposal.moves.every((move) => move.folderId !== 'github-bar')).toBe(true);
    expect(proposal.creates).toEqual([
      expect.objectContaining({ parentId: '2', title: 'GitHub' }),
    ]);
    expect(proposal.moves).toHaveLength(2);
    expect(proposal.moves.every((move) => move.folderId === proposal.creates[0]?.clientId)).toBe(true);
  });

  test('does not use Mobile folders as organize destinations', () => {
    const proposal = organizeFrom(
      [
        page('g1', 'https://github.com/acme/one', '2', 'One'),
        page('g2', 'https://github.com/acme/two', '2', 'Two'),
      ],
      [],
      [],
      [{
        id: 'github-mobile',
        parentId: '3',
        title: 'Github',
        children: [],
      }],
    );
    expect(proposal.creates).toEqual([
      expect.objectContaining({ parentId: '2', title: 'GitHub' }),
    ]);
    expect(proposal.moves).toHaveLength(2);
    expect(proposal.moves.every((move) => move.folderId !== 'github-mobile')).toBe(true);
    expect(proposal.moves.every((move) => move.folderId === proposal.creates[0]?.clientId)).toBe(true);
  });
});

describe('sanitizeBookmarkTopicProposal', () => {
  test('sanitizes topic groups and merges leftover host clusters', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([{
      id: 'proj',
      parentId: '2',
      title: 'Interesting Projects',
      children: [
        page('g1', 'https://github.com/acme/one', 'proj', 'One'),
        page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
        page('f1', 'https://figma.com/file/aaa', 'proj', 'Board'),
        page('f2', 'https://figma.com/file/bbb', 'proj', 'Board 2'),
      ],
    }, { id: 'design', parentId: '2', title: 'Design', children: [] }]));

    const topic = sanitizeBookmarkTopicProposal({
      groups: [
        { name: 'Design', bookmarkIds: ['f1', 'missing', 'f1'], folderId: 'design' },
        { name: 'Inbox', bookmarkIds: ['g1', 'g2'] },
      ],
    }, bookmarks, folders, 'other');

    expect(topic.moves).toEqual([{ bookmarkId: 'f1', folderId: 'design' }]);
    expect(topic.creates).toEqual([]);

    const merged = mergeTopicWithHostOrganize(topic, bookmarks, folders, 'other');
    expect(merged.moves.some((move) => move.bookmarkId === 'f1' && move.folderId === 'design')).toBe(true);
    expect(merged.creates.some((create) => create.title === 'GitHub')).toBe(true);
    expect(merged.moves.filter((move) => move.bookmarkId === 'g1' || move.bookmarkId === 'g2')).toHaveLength(2);
  });

  test('drops a one-bookmark create group and keeps a one-bookmark Figma reuse', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([
      { id: 'figma', parentId: '2', title: 'Figma', children: [] },
      {
        id: 'proj',
        parentId: '2',
        title: 'Interesting Projects',
        children: [
          page('f1', 'https://figma.com/file/aaa', 'proj', 'Board'),
          page('solo', 'https://lonely.example/page', 'proj', 'Only'),
        ],
      },
    ]));

    const topic = sanitizeBookmarkTopicProposal({
      groups: [
        { name: 'Figma', bookmarkIds: ['f1'] },
        { name: 'Lonely', bookmarkIds: ['solo'] },
      ],
    }, bookmarks, folders, 'other');

    expect(topic.creates).toEqual([]);
    expect(topic.moves).toEqual([{ bookmarkId: 'f1', folderId: 'figma' }]);
  });

  test('drops nested bar and managed ids from topic groups', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree(
      [{
        id: 'proj',
        parentId: '2',
        title: 'Interesting Projects',
        children: [
          page('g1', 'https://github.com/acme/one', 'proj', 'One'),
          page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
        ],
      }],
      [{
        id: 'work',
        parentId: '1',
        title: 'Work',
        children: [
          page('bar1', 'https://github.com/acme/bar-one', 'work'),
          page('bar2', 'https://github.com/acme/bar-two', 'work'),
        ],
      }],
      [{
        id: '99',
        parentId: '0',
        title: 'Managed',
        folderType: 'managed',
        unmodifiable: 'managed',
        children: [
          page('m1', 'https://github.com/acme/managed-one', '99'),
          page('m2', 'https://github.com/acme/managed-two', '99'),
        ],
      }],
    ));

    const topic = sanitizeBookmarkTopicProposal({
      groups: [{
        name: 'Github',
        bookmarkIds: ['g1', 'g2', 'bar1', 'bar2', 'm1', 'm2'],
      }],
    }, bookmarks, folders, 'other');

    expect(topic.creates).toEqual([
      expect.objectContaining({ parentId: '2', title: 'Github' }),
    ]);
    expect(topic.moves.map((move) => move.bookmarkId).sort()).toEqual(['g1', 'g2']);
    expect(topic.moves.some((move) => ['bar1', 'bar2', 'm1', 'm2'].includes(move.bookmarkId))).toBe(false);
  });

  test('does not let leftover host organize move a topic already-home bookmark', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([
      {
        id: 'design',
        parentId: '2',
        title: 'Design',
        children: [page('f1', 'https://figma.com/file/aaa', 'design', 'Board')],
      },
      {
        id: 'proj',
        parentId: '2',
        title: 'Interesting Projects',
        children: [
          page('f2', 'https://figma.com/file/bbb', 'proj', 'Board 2'),
          page('f3', 'https://figma.com/file/ccc', 'proj', 'Board 3'),
        ],
      },
    ]));

    const topic = sanitizeBookmarkTopicProposal({
      groups: [{ name: 'Design', bookmarkIds: ['f1'] }],
    }, bookmarks, folders, 'other');

    expect(topic.moves.some((move) => move.bookmarkId === 'f1')).toBe(false);

    const merged = mergeTopicWithHostOrganize(topic, bookmarks, folders, 'other');
    expect(merged.moves.some((move) => move.bookmarkId === 'f1')).toBe(false);
  });

  test('reuses a topic create when leftover host would make the same folder title', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([{
      id: 'proj',
      parentId: '2',
      title: 'Interesting Projects',
      children: [
        page('g1', 'https://github.com/acme/one', 'proj', 'One'),
        page('g2', 'https://github.com/acme/two', 'proj', 'Two'),
        page('g3', 'https://github.com/acme/three', 'proj', 'Three'),
        page('g4', 'https://github.com/acme/four', 'proj', 'Four'),
        page('solo', 'https://lonely.example/page', 'proj', 'Only'),
        page('other', 'https://unique.example/page', 'proj', 'Unique'),
      ],
    }]));

    const topic = sanitizeBookmarkTopicProposal({
      groups: [{ name: 'Github', bookmarkIds: ['g1', 'g2'] }],
    }, bookmarks, folders, 'other');
    const clientId = topic.creates[0]?.clientId;
    expect(clientId).toBeTruthy();
    expect(topic.creates).toEqual([expect.objectContaining({ title: 'Github' })]);

    const merged = mergeTopicWithHostOrganize(topic, bookmarks, folders, 'other');
    expect(merged.creates).toEqual([expect.objectContaining({ clientId, title: 'Github' })]);
    expect(merged.moves).toHaveLength(4);
    expect(merged.moves.map((move) => move.bookmarkId).sort()).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(merged.moves.every((move) => move.folderId === clientId)).toBe(true);
  });
});

test('constrainOrganizePlan drops a move whose bookmark is on the bar', () => {
  const { bookmarks, folders } = flattenBookmarkTree(tree(
    [
      { id: 'github', parentId: '2', title: 'Github', children: [] },
      page('g1', 'https://github.com/acme/one', '2', 'One'),
    ],
    [page('bar1', 'https://github.com/acme/bar-one', '1')],
  ));

  const constrained = constrainOrganizePlan({
    creates: [{ clientId: 'organize-topic-work', parentId: '2', title: 'Work' }],
    moves: [
      { bookmarkId: 'bar1', folderId: 'github' },
      { bookmarkId: 'g1', folderId: 'github' },
    ],
  }, bookmarks, folders, 'other');

  expect(constrained.moves).toEqual([{ bookmarkId: 'g1', folderId: 'github' }]);
  expect(constrained.creates).toEqual([]);
});

test('constrainOrganizePlan drops a create when no surviving move targets it', () => {
  const { bookmarks, folders } = flattenBookmarkTree(tree(
    [page('g1', 'https://github.com/acme/one', '2', 'One')],
    [
      page('bar1', 'https://github.com/acme/bar-one', '1'),
      page('bar2', 'https://github.com/acme/bar-two', '1'),
    ],
  ));

  const constrained = constrainOrganizePlan({
    creates: [{ clientId: 'organize-topic-work', parentId: '2', title: 'Work' }],
    moves: [
      { bookmarkId: 'bar1', folderId: 'organize-topic-work' },
      { bookmarkId: 'bar2', folderId: 'organize-topic-work' },
    ],
  }, bookmarks, folders, 'other');

  expect(constrained).toEqual({ creates: [], moves: [] });
});

function snap(id: string, createdAt: number): BookmarkOrganizeSnapshot {
  return { id, createdAt, expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000, moveCount: 1, createdFolderIds: [], nodes: [{ id: 'n', parentId: '2', index: 0 }] };
}

test('drops expired snapshots, then the oldest past three', () => {
  const now = 1_000_000;
  const kept = pruneBookmarkOrganizeSnapshots([
    snap('old', now - 8 * 24 * 60 * 60 * 1000),
    snap('a', now - 3_000),
    snap('b', now - 2_000),
    snap('c', now - 1_000),
    snap('d', now - 100),
  ], now);
  expect(kept.map((item) => item.id)).toEqual(['b', 'c', 'd']);
});

test('restores in original index order and only deletes empty created folders', () => {
  const snapshot = {
    id: 's1',
    createdAt: 1,
    expiresAt: 9,
    moveCount: 2,
    createdFolderIds: ['new', 'kept'],
    nodes: [
      { id: 'b2', parentId: 'proj', index: 1 },
      { id: 'b1', parentId: 'proj', index: 0 },
      { id: 'gone', parentId: 'proj', index: 2 },
    ],
  };
  const liveBookmarks = [
    { id: 'b1', parentId: 'new', title: 'A', url: 'https://a.example', folderPath: '', isInbox: false, isBookmarksBar: false, folderKind: 'other' as const, index: 0 },
    { id: 'b2', parentId: 'new', title: 'B', url: 'https://b.example', folderPath: '', isInbox: false, isBookmarksBar: false, folderKind: 'other' as const, index: 1 },
  ];
  const liveFolders = [
    { id: '2', folderKind: 'other' as const, title: 'Other', folderPath: 'Other', isInbox: false, isSpecialRoot: true, isBookmarksBar: false, index: 1 },
    { id: 'proj', parentId: '2', folderKind: 'folder' as const, title: 'Proj', folderPath: 'Other / Proj', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 0 },
    { id: 'new', parentId: '2', folderKind: 'folder' as const, title: 'Design', folderPath: 'Other / Design', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 1 },
    { id: 'kept', parentId: '2', folderKind: 'folder' as const, title: 'Kept', folderPath: 'Other / Kept', isInbox: false, isSpecialRoot: false, isBookmarksBar: false, index: 2 },
  ];
  const plan = planBookmarkOrganizeRestore(snapshot, liveBookmarks, liveFolders, new Map([['new', 0], ['kept', 2], ['proj', 0]]));
  expect(plan.moves.map((move) => move.id)).toEqual(['b1', 'b2']);
  expect(plan.moves[0]).toMatchObject({ parentId: 'proj', index: 0 });
  expect(plan.deleteFolderIds).toEqual(['new']);
  expect(plan.skipped).toBe(1);
});

test('drops an empty organize snapshot after a no-op apply', () => {
  const base = { id: 's', createdAt: 1, expiresAt: 9, moveCount: 2, createdFolderIds: [], nodes: [{ id: 'a', parentId: '2', index: 0 }] };
  expect(finalizeOrganizeSnapshot(base, [], 0)).toBeNull();
  expect(finalizeOrganizeSnapshot(base, ['f'], 0)?.createdFolderIds).toEqual(['f']);
});

test('insertOrganizeSnapshot reports the evicted snapshot so a no-op can restore it', () => {
  const now = 1_000_000;
  const incoming = snap('d', now);
  const { next, evicted } = insertOrganizeSnapshot([
    snap('a', now - 3_000),
    snap('b', now - 2_000),
    snap('c', now - 1_000),
  ], incoming, now);
  expect(next.map((item) => item.id)).toEqual(['b', 'c', 'd']);
  expect(evicted.map((item) => item.id)).toEqual(['a']);

  const restored = commitInsertedOrganizeSnapshot(next, incoming.id, null, evicted, now);
  expect(restored.map((item) => item.id)).toEqual(['a', 'b', 'c']);

  const finalized = finalizeOrganizeSnapshot(incoming, ['folder'], 2);
  expect(finalized).toBeTruthy();
  const committed = commitInsertedOrganizeSnapshot(next, incoming.id, finalized, evicted, now);
  expect(committed.map((item) => item.id)).toEqual(['b', 'c', 'd']);
  expect(committed.find((item) => item.id === 'd')?.createdFolderIds).toEqual(['folder']);
  expect(committed.find((item) => item.id === 'd')?.moveCount).toBe(2);
});

test('uses in-progress filing counts when apply throws before returning', () => {
  expect(organizeApplyFinalizeInput(undefined, {
    moved: 2,
    created: [{ clientId: 'organize-topic-github', id: 'folder' }],
  })).toEqual({ createdFolderIds: ['folder'], moveCount: 2 });
  expect(organizeApplyFinalizeInput({
    moved: 1,
    created: [{ clientId: 'organize-topic-github', id: 'kept' }],
  }, { moved: 0, created: [] })).toEqual({ createdFolderIds: ['kept'], moveCount: 1 });
});

test('hides expired organize snapshots and those with less than one day left', () => {
  const now = 1_000_000_000_000;
  const day = 86_400_000;
  const visible = visibleBookmarkOrganizeSnapshots([
    { id: 'expired', createdAt: now - day * 8, expiresAt: now - 1, moveCount: 2 },
    { id: 'zero', createdAt: now - day * 7, expiresAt: now, moveCount: 2 },
    { id: 'today', createdAt: now - day * 6, expiresAt: now + 12 * 60 * 60 * 1000, moveCount: 3 },
    { id: 'week', createdAt: now, expiresAt: now + day * 7, moveCount: 4 },
  ], now);
  expect(visible.map((item) => [item.id, item.daysLeft])).toEqual([
    ['today', 1],
    ['week', 7],
  ]);
});

describe('BookmarkOrganizeScope in canOrganizeBookmark', () => {
  const { bookmarks, folders } = flattenBookmarkTree(tree(
    [
      page('other-root-1', 'https://github.com/one', '2'),
      {
        id: 'other-sub',
        parentId: '2',
        title: 'Other Sub',
        children: [page('other-nested-1', 'https://github.com/nested', 'other-sub')],
      },
      {
        id: 'inbox-folder',
        parentId: '2',
        title: 'Inbox',
        children: [page('inbox-1', 'https://github.com/inbox', 'inbox-folder')],
      },
    ],
    [
      page('bar-root-1', 'https://github.com/bar', '1'),
      {
        id: 'bar-sub',
        parentId: '1',
        title: 'Bar Sub',
        children: [page('bar-nested-1', 'https://github.com/barnested', 'bar-sub')],
      },
    ],
    [{
      id: '99',
      parentId: '0',
      title: 'Managed',
      folderType: 'managed',
      unmodifiable: 'managed',
      children: [page('managed-1', 'https://github.com/managed', '99')],
    }],
    [page('mobile-1', 'https://github.com/mobile', '3')],
  ));

  const byId = new Map(bookmarks.map((b) => [b.id, b]));

  test('scope: unfiled allows direct root children of bar, other, and inbox', () => {
    expect(canOrganizeBookmark(byId.get('bar-root-1')!, folders, undefined, 'unfiled')).toBe(true);
    expect(canOrganizeBookmark(byId.get('other-root-1')!, folders, undefined, 'unfiled')).toBe(true);
    expect(canOrganizeBookmark(byId.get('inbox-1')!, folders, undefined, 'unfiled')).toBe(true);

    expect(canOrganizeBookmark(byId.get('bar-nested-1')!, folders, undefined, 'unfiled')).toBe(false);
    expect(canOrganizeBookmark(byId.get('other-nested-1')!, folders, undefined, 'unfiled')).toBe(false);

    expect(canOrganizeBookmark(byId.get('managed-1')!, folders, undefined, 'unfiled')).toBe(false);
    expect(canOrganizeBookmark(byId.get('mobile-1')!, folders, undefined, 'unfiled')).toBe(false);
  });

  test('scope: bar allows direct and nested bookmarks bar items only', () => {
    expect(canOrganizeBookmark(byId.get('bar-root-1')!, folders, undefined, 'bar')).toBe(true);
    expect(canOrganizeBookmark(byId.get('bar-nested-1')!, folders, undefined, 'bar')).toBe(true);

    expect(canOrganizeBookmark(byId.get('other-root-1')!, folders, undefined, 'bar')).toBe(false);
    expect(canOrganizeBookmark(byId.get('other-nested-1')!, folders, undefined, 'bar')).toBe(false);
    expect(canOrganizeBookmark(byId.get('inbox-1')!, folders, undefined, 'bar')).toBe(false);
    expect(canOrganizeBookmark(byId.get('managed-1')!, folders, undefined, 'bar')).toBe(false);
    expect(canOrganizeBookmark(byId.get('mobile-1')!, folders, undefined, 'bar')).toBe(false);
  });

  test('scope: other allows direct and nested other bookmarks only', () => {
    expect(canOrganizeBookmark(byId.get('other-root-1')!, folders, undefined, 'other')).toBe(true);
    expect(canOrganizeBookmark(byId.get('other-nested-1')!, folders, undefined, 'other')).toBe(true);
    expect(canOrganizeBookmark(byId.get('inbox-1')!, folders, undefined, 'other')).toBe(true);

    expect(canOrganizeBookmark(byId.get('bar-root-1')!, folders, undefined, 'other')).toBe(false);
    expect(canOrganizeBookmark(byId.get('bar-nested-1')!, folders, undefined, 'other')).toBe(false);
    expect(canOrganizeBookmark(byId.get('managed-1')!, folders, undefined, 'other')).toBe(false);
    expect(canOrganizeBookmark(byId.get('mobile-1')!, folders, undefined, 'other')).toBe(false);
  });

  test('scope: all allows modifiable bookmarks across bar and other', () => {
    expect(canOrganizeBookmark(byId.get('bar-root-1')!, folders, undefined, 'all')).toBe(true);
    expect(canOrganizeBookmark(byId.get('bar-nested-1')!, folders, undefined, 'all')).toBe(true);
    expect(canOrganizeBookmark(byId.get('other-root-1')!, folders, undefined, 'all')).toBe(true);
    expect(canOrganizeBookmark(byId.get('other-nested-1')!, folders, undefined, 'all')).toBe(true);
    expect(canOrganizeBookmark(byId.get('inbox-1')!, folders, undefined, 'all')).toBe(true);

    expect(canOrganizeBookmark(byId.get('managed-1')!, folders, undefined, 'all')).toBe(false);
    expect(canOrganizeBookmark(byId.get('mobile-1')!, folders, undefined, 'all')).toBe(false);
  });
});

describe('BookmarkOrganizeScope in organizeDestinationFolders', () => {
  const { folders } = flattenBookmarkTree(tree(
    [
      { id: 'other-folder', parentId: '2', title: 'Other Folder', children: [] },
      { id: 'inbox-folder', parentId: '2', title: 'Inbox', children: [] },
    ],
    [
      { id: 'bar-folder', parentId: '1', title: 'Bar Folder', children: [] },
    ],
    [],
    [
      { id: 'mobile-folder', parentId: '3', title: 'Mobile Folder', children: [] },
    ],
  ));

  test('scope: unfiled includes Bookmarks Bar destinations, while other excludes them', () => {
    const unfiledDest = organizeDestinationFolders(folders, 'unfiled');
    expect(unfiledDest.map((f) => f.id)).toContain('other-folder');
    expect(unfiledDest.map((f) => f.id)).toContain('bar-folder');
    expect(unfiledDest.map((f) => f.id)).not.toContain('inbox-folder');
    expect(unfiledDest.map((f) => f.id)).not.toContain('mobile-folder');

    const otherDest = organizeDestinationFolders(folders, 'other');
    expect(otherDest.map((f) => f.id)).toContain('other-folder');
    expect(otherDest.map((f) => f.id)).not.toContain('bar-folder');
  });

  test('scope: bar and all include Bookmarks Bar destinations', () => {
    const barDest = organizeDestinationFolders(folders, 'bar');
    expect(barDest.map((f) => f.id)).toContain('bar-folder');
    expect(barDest.map((f) => f.id)).toContain('other-folder');
    expect(barDest.map((f) => f.id)).not.toContain('inbox-folder');
    expect(barDest.map((f) => f.id)).not.toContain('mobile-folder');

    const allDest = organizeDestinationFolders(folders, 'all');
    expect(allDest.map((f) => f.id)).toContain('bar-folder');
    expect(allDest.map((f) => f.id)).toContain('other-folder');
  });
});

describe('BookmarkOrganizeScope in proposeBookmarkOrganize', () => {
  test('scope: bar creates new folders under Bookmarks Bar root (1)', () => {
    const proposal = organizeFrom(
      [],
      [
        page('b1', 'https://github.com/one', '1', 'One'),
        page('b2', 'https://github.com/two', '1', 'Two'),
      ],
      [],
      [],
      'bar',
    );

    expect(proposal.creates).toEqual([
      expect.objectContaining({ parentId: '1', title: 'GitHub' }),
    ]);
    expect(proposal.moves).toHaveLength(2);
    expect(proposal.moves.every((move) => move.folderId === proposal.creates[0]?.clientId)).toBe(true);
  });

  test('scope: unfiled organizes direct root items and skips subfolder items', () => {
    const proposal = organizeFrom(
      [
        page('r1', 'https://github.com/one', '2', 'Root 1'),
        page('r2', 'https://github.com/two', '2', 'Root 2'),
        {
          id: 'sub',
          parentId: '2',
          title: 'Sub',
          children: [
            page('s1', 'https://figma.com/one', 'sub', 'Sub 1'),
            page('s2', 'https://figma.com/two', 'sub', 'Sub 2'),
          ],
        },
      ],
      [],
      [],
      [],
      'unfiled',
    );

    expect(proposal.creates.map((c) => c.title)).toEqual(['GitHub']);
    expect(proposal.moves.map((m) => m.bookmarkId)).toEqual(['r1', 'r2']);
  });

  test('clusters GDrive, Gmail, and NotebookLM into Google under Bookmarks Bar root (1) in unfiled scope', () => {
    const proposal = organizeFrom(
      [],
      [
        page('g1', 'https://drive.google.com/drive/my-drive', '1', 'My Drive - Google Drive'),
        page('g2', 'https://mail.google.com/mail/u/0', '1', 'Inbox - Gmail'),
        page('g3', 'https://notebooklm.google.com/', '1', 'NotebookLM'),
      ],
      [],
      [],
      'unfiled',
    );

    expect(proposal.creates).toEqual([
      expect.objectContaining({ parentId: '1', title: 'Google' }),
    ]);
    expect(proposal.clusters).toEqual([
      expect.objectContaining({
        folderTitle: 'Google',
        create: true,
        bookmarkIds: expect.arrayContaining(['g1', 'g2', 'g3']),
      }),
    ]);
    expect(proposal.moves).toHaveLength(3);
    const googleClientId = proposal.creates[0]?.clientId;
    expect(proposal.moves).toEqual(
      expect.arrayContaining([
        { bookmarkId: 'g1', folderId: googleClientId },
        { bookmarkId: 'g2', folderId: googleClientId },
        { bookmarkId: 'g3', folderId: googleClientId },
      ]),
    );
  });
});

describe('BookmarkOrganizeScope in constrainOrganizePlan', () => {
  test('allows create under bar root (1) when scope is bar, all, or unfiled', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree(
      [],
      [
        page('b1', 'https://github.com/one', '1', 'One'),
        page('b2', 'https://github.com/two', '1', 'Two'),
      ],
    ));

    const plan = {
      creates: [{ clientId: 'bar-github', parentId: '1', title: 'GitHub' }],
      moves: [
        { bookmarkId: 'b1', folderId: 'bar-github' },
        { bookmarkId: 'b2', folderId: 'bar-github' },
      ],
    };

    const barConstrained = constrainOrganizePlan(plan, bookmarks, folders, 'bar');
    expect(barConstrained.creates).toHaveLength(1);
    expect(barConstrained.creates[0]?.parentId).toBe('1');
    expect(barConstrained.moves).toHaveLength(2);

    const allConstrained = constrainOrganizePlan(plan, bookmarks, folders, 'all');
    expect(allConstrained.creates).toHaveLength(1);
    expect(allConstrained.moves).toHaveLength(2);

    const unfiledConstrained = constrainOrganizePlan(plan, bookmarks, folders, 'unfiled');
    expect(unfiledConstrained.creates).toHaveLength(1);
    expect(unfiledConstrained.creates[0]?.parentId).toBe('1');
    expect(unfiledConstrained.moves).toHaveLength(2);

    const otherConstrained = constrainOrganizePlan(plan, bookmarks, folders, 'other');
    expect(otherConstrained.creates).toHaveLength(0);
    expect(otherConstrained.moves).toHaveLength(0);
  });
});

describe('proposeBookmarkOrganize title keyword matching and clustering (Tier 1)', () => {
  test('Priority 1: files bookmarks matching existing folder title keywords regardless of domain', () => {
    const proposal = organizeFrom([
      { id: 'react-dest', parentId: '2', title: 'React', children: [] },
      page('b1', 'https://juejin.cn/post/1', '2', 'React 19 Release Notes'),
      page('b2', 'https://medium.com/foo', '2', 'React Hooks 入门'),
    ]);

    expect(proposal.creates).toEqual([]);
    expect(proposal.moves).toEqual([
      { bookmarkId: 'b1', folderId: 'react-dest' },
      { bookmarkId: 'b2', folderId: 'react-dest' },
    ]);
    expect(proposal.clusters).toHaveLength(1);
    expect(proposal.clusters[0]?.folderTitle).toBe('React');
    expect(proposal.clusters[0]?.create).toBe(false);
  });

  test('Priority 1: matches CJK folder names like 前端开发 with platform suffixes stripped', () => {
    const proposal = organizeFrom([
      { id: 'fe-dest', parentId: '2', title: '前端开发', children: [] },
      page('b1', 'https://zhihu.com/question/1', '2', 'Web 前端开发入门指南 - 知乎'),
    ]);

    expect(proposal.creates).toEqual([]);
    expect(proposal.moves).toEqual([
      { bookmarkId: 'b1', folderId: 'fe-dest' },
    ]);
    expect(proposal.clusters[0]?.create).toBe(false);
  });

  test('Priority 2: groups bookmarks sharing distinctive keywords across different domains', () => {
    const proposal = organizeFrom([
      page('d1', 'https://juejin.cn/post/10', '2', 'Docker 实践指南'),
      page('d2', 'https://medium.com/bar', '2', 'Docker Compose 深入解析'),
      page('k1', 'https://zhihu.com/p/20', '2', 'Kubernetes 集群搭建'),
      page('k2', 'https://segmentfault.com/a/30', '2', 'Kubernetes 核心概念总结 - SegmentFault 思否'),
    ]);

    expect(proposal.creates.map((c) => c.title).sort()).toEqual(['Docker', 'Kubernetes']);
    const dockerCreate = proposal.creates.find((c) => c.title === 'Docker');
    const k8sCreate = proposal.creates.find((c) => c.title === 'Kubernetes');
    expect(dockerCreate && k8sCreate).toBeTruthy();

    expect(proposal.moves.filter((m) => m.folderId === dockerCreate?.clientId).map((m) => m.bookmarkId).sort())
      .toEqual(['d1', 'd2']);
    expect(proposal.moves.filter((m) => m.folderId === k8sCreate?.clientId).map((m) => m.bookmarkId).sort())
      .toEqual(['k1', 'k2']);
  });

  test('Priority 2: clusters CJK keywords like 面试 or 论文', () => {
    const proposal = organizeFrom([
      page('m1', 'https://leetcode.cn/problems/1', '2', '算法面试高频题目总结'),
      page('m2', 'https://nowcoder.com/discuss/2', '2', '大厂面试经验分享'),
    ]);

    expect(proposal.creates).toHaveLength(1);
    expect(proposal.creates[0]?.title).toBe('面试');
    expect(proposal.moves.map((m) => m.bookmarkId).sort()).toEqual(['m1', 'm2']);
    expect(proposal.clusters[0]?.create).toBe(true);
    expect(proposal.clusters[0]?.folderTitle).toBe('面试');
  });

  test('Combines Priority 1, Priority 2, and Priority 3 cleanly without duplicate bookmarks', () => {
    const proposal = organizeFrom([
      { id: 'react-dest', parentId: '2', title: 'React', children: [] },
      // Priority 1: matches existing React folder
      page('r1', 'https://juejin.cn/1', '2', 'React 19 全新特性解读'),
      // Priority 2: groups by Docker keyword (different domains)
      page('d1', 'https://medium.com/2', '2', 'Docker 入门指南'),
      page('d2', 'https://dev.to/3', '2', 'Docker Compose 进阶'),
      // Priority 3: fallback to host github.com
      page('g1', 'https://github.com/acme/alpha', '2', 'Alpha Tool'),
      page('g2', 'https://github.com/acme/beta', '2', 'Beta Release'),
    ]);

    // React matched existing -> no create
    // Docker keyword created -> Docker
    // GitHub host created -> GitHub
    expect(proposal.creates.map((c) => c.title).sort()).toEqual(['Docker', 'GitHub']);

    // React move
    expect(proposal.moves.find((m) => m.bookmarkId === 'r1')?.folderId).toBe('react-dest');

    // Docker moves
    const dockerCreate = proposal.creates.find((c) => c.title === 'Docker');
    expect(proposal.moves.filter((m) => m.folderId === dockerCreate?.clientId).map((m) => m.bookmarkId).sort())
      .toEqual(['d1', 'd2']);

    // GitHub moves
    const githubCreate = proposal.creates.find((c) => c.title === 'GitHub');
    expect(proposal.moves.filter((m) => m.folderId === githubCreate?.clientId).map((m) => m.bookmarkId).sort())
      .toEqual(['g1', 'g2']);

    // No duplicate bookmark moves or cluster items
    const movedIds = proposal.moves.map((m) => m.bookmarkId);
    expect(new Set(movedIds).size).toBe(movedIds.length);

    const clusterIds = proposal.clusters.flatMap((c) => c.bookmarkIds);
    expect(new Set(clusterIds).size).toBe(clusterIds.length);
  });
});


