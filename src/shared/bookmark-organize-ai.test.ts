import { describe, expect, test } from 'vitest';
import { flattenBookmarkTree } from './bookmarks';
import {
  BOOKMARK_ORGANIZE_CLOUD_LIMIT,
  BOOKMARK_ORGANIZE_LOCAL_LIMIT,
  buildTopicAnalyzePayload,
  parseTopicOrganizeJson,
  selectAnalyzeBookmarks,
  topicOrganizePrompt,
  topicProposalFromModel,
} from './bookmark-organize-ai';

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

describe('bookmark topic analyze limits and payload', () => {
  test('dynamically sets analyze limits (default 35 for local, 100 for cloud, custom limits)', () => {
    const otherChildren = Array.from({ length: 120 }, (_, index) => (
      page(`p${index}`, `https://ex.example/item/${index}?token=secret`, '2', `P${index}`)
    ));
    const { bookmarks, folders } = flattenBookmarkTree(tree(otherChildren));

    // Default limit should be 35 (local-model default)
    const localResult = selectAnalyzeBookmarks(bookmarks, folders);
    expect(localResult.eligible.length).toBe(120);
    expect(localResult.analyzed).toHaveLength(BOOKMARK_ORGANIZE_LOCAL_LIMIT);
    expect(localResult.analyzed).toHaveLength(35);

    // Explicit cloud limit (100)
    const cloudResult = selectAnalyzeBookmarks(bookmarks, folders, 'unfiled', BOOKMARK_ORGANIZE_CLOUD_LIMIT);
    expect(cloudResult.eligible.length).toBe(120);
    expect(cloudResult.analyzed).toHaveLength(BOOKMARK_ORGANIZE_CLOUD_LIMIT);
    expect(cloudResult.analyzed).toHaveLength(100);

    // Custom limit (e.g. 15)
    const customResult = selectAnalyzeBookmarks(bookmarks, folders, 'unfiled', 15);
    expect(customResult.eligible.length).toBe(120);
    expect(customResult.analyzed).toHaveLength(15);
  });

  test('buildTopicAnalyzePayload cleans bookmark titles and includes folderPath taxonomy', () => {
    const techFolder: Node = {
      id: 'tech',
      parentId: '2',
      title: 'Tech',
      children: [
        {
          id: 'frontend',
          parentId: 'tech',
          title: 'Frontend',
          children: [
            page('b1', 'https://youtube.com/watch?v=123', 'frontend', 'React 19 Deep Dive - YouTube'),
            page('b2', 'https://juejin.cn/post/456', 'frontend', '【前端】Vue3 响应式原理 - 掘金'),
          ],
        },
      ],
    };
    const looseBookmarks = [
      page('b3', 'https://github.com/torvalds/linux', '2', 'Linux Kernel - GitHub'),
      page('b4', 'https://google.com/search?q=zen-tab&client=chrome', '2', 'Zen Tab - Google Search'),
    ];

    const { bookmarks, folders } = flattenBookmarkTree(tree([techFolder, ...looseBookmarks]));
    const { analyzed } = selectAnalyzeBookmarks(bookmarks, folders, 'all', 100);
    const payload = buildTopicAnalyzePayload(analyzed, folders, 'zh');

    // 1. Check folder hierarchy paths are present
    const frontendDest = payload.folders.find((f) => f.id === 'frontend');
    expect(frontendDest).toBeDefined();
    expect(frontendDest?.title).toBe('Frontend');
    expect(frontendDest?.folderPath).toBe('Other Bookmarks / Tech / Frontend');

    const techDest = payload.folders.find((f) => f.id === 'tech');
    expect(techDest).toBeDefined();
    expect(techDest?.title).toBe('Tech');
    expect(techDest?.folderPath).toBe('Other Bookmarks / Tech');

    // 2. Check bookmark titles are cleaned of platform noise
    const b1 = payload.bookmarks.find((b) => b.id === 'b1');
    expect(b1?.title).toBe('React 19 Deep Dive');

    const b2 = payload.bookmarks.find((b) => b.id === 'b2');
    expect(b2?.title).toBe('Vue3 响应式原理');

    const b3 = payload.bookmarks.find((b) => b.id === 'b3');
    expect(b3?.title).toBe('Linux Kernel');

    const b4 = payload.bookmarks.find((b) => b.id === 'b4');
    expect(b4?.title).toBe('Zen Tab');
    // Path strips query params
    expect(b4?.path).toBe('/search');
    expect(b4?.path.includes('client')).toBe(false);
  });

  test('topicOrganizePrompt emphasizes prioritizing existing folders and strict JSON output', () => {
    const techFolder: Node = {
      id: 'tech',
      parentId: '2',
      title: 'Tech',
      children: [page('b1', 'https://github.com/foo/bar', 'tech', 'Repo')],
    };
    const { bookmarks, folders } = flattenBookmarkTree(tree([techFolder]));
    const { analyzed } = selectAnalyzeBookmarks(bookmarks, folders);

    const zhPayload = buildTopicAnalyzePayload(analyzed, folders, 'zh');
    const zhPrompt = topicOrganizePrompt(zhPayload);
    expect(zhPrompt).toContain('优先复用已有文件夹');
    expect(zhPrompt).toContain('folderPath');
    expect(zhPrompt).toContain('只输出纯 JSON');
    expect(zhPrompt).toContain('"folderPath":"Other Bookmarks / Tech"');

    const enPayload = buildTopicAnalyzePayload(analyzed, folders, 'en');
    const enPrompt = topicOrganizePrompt(enPayload);
    expect(enPrompt).toContain('Prioritize existing folders');
    expect(enPrompt).toContain('folderPath');
    expect(enPrompt).toContain('Output STRICT JSON ONLY');
  });
});

describe('parseTopicOrganizeJson robust JSON parsing', () => {
  test('parses plain JSON string', () => {
    const raw = JSON.stringify({
      groups: [
        { name: 'Frontend', bookmarkIds: ['b1', 'b2'], folderId: 'f1' },
      ],
    });
    expect(parseTopicOrganizeJson(raw)).toEqual([
      { name: 'Frontend', bookmarkIds: ['b1', 'b2'], folderId: 'f1' },
    ]);
  });

  test('parses markdown code block with ```json tag', () => {
    const raw = `\`\`\`json
{
  "groups": [
    { "name": "AI & ML", "bookmarkIds": ["a1", "a2"] }
  ]
}
\`\`\``;
    expect(parseTopicOrganizeJson(raw)).toEqual([
      { name: 'AI & ML', bookmarkIds: ['a1', 'a2'] },
    ]);
  });

  test('parses markdown code block without json language tag', () => {
    const raw = `\`\`\`
{
  "groups": [
    { "name": "Tools", "bookmarkIds": ["t1"] }
  ]
}
\`\`\``;
    expect(parseTopicOrganizeJson(raw)).toEqual([
      { name: 'Tools', bookmarkIds: ['t1'] },
    ]);
  });

  test('handles conversational preamble and postamble around code blocks', () => {
    const raw = `Sure! Here is the classification result based on your existing folder hierarchy:
\`\`\`json
{
  "groups": [
    { "name": "Tech", "bookmarkIds": ["b10", "b11"], "folderId": "tech" },
    { "name": "Design Systems", "bookmarkIds": ["d1", "d2"] }
  ]
}
\`\`\`
I hope this taxonomy helps organize your bookmarks neatly!`;
    expect(parseTopicOrganizeJson(raw)).toEqual([
      { name: 'Tech', bookmarkIds: ['b10', 'b11'], folderId: 'tech' },
      { name: 'Design Systems', bookmarkIds: ['d1', 'd2'] },
    ]);
  });

  test('handles conversational text with raw JSON without code fences', () => {
    const raw = `Here is the JSON: {"groups":[{"name":"Cloud","bookmarkIds":["c1"],"folderId":"f2"}]} let me know what you think.`;
    expect(parseTopicOrganizeJson(raw)).toEqual([
      { name: 'Cloud', bookmarkIds: ['c1'], folderId: 'f2' },
    ]);
  });

  test('parses direct object input and direct array input', () => {
    expect(parseTopicOrganizeJson({
      groups: [{ name: 'Reading', bookmarkIds: ['r1'] }],
    })).toEqual([{ name: 'Reading', bookmarkIds: ['r1'] }]);

    expect(parseTopicOrganizeJson([
      { name: 'Direct Array Group', bookmarkIds: ['d1'] },
    ])).toEqual([{ name: 'Direct Array Group', bookmarkIds: ['d1'] }]);
  });

  test('filters out invalid groups and drops garbage', () => {
    expect(parseTopicOrganizeJson(null)).toEqual([]);
    expect(parseTopicOrganizeJson(undefined)).toEqual([]);
    expect(parseTopicOrganizeJson('')).toEqual([]);
    expect(parseTopicOrganizeJson('random unparseable gibberish')).toEqual([]);
    expect(parseTopicOrganizeJson({ nope: true })).toEqual([]);

    const mixed = {
      groups: [
        null,
        {},
        { name: '', bookmarkIds: ['1'] }, // empty name
        { name: 123, bookmarkIds: ['1'] }, // non-string name
        { name: 'Valid', bookmarkIds: [] }, // empty ids
        { name: 'Valid 2', bookmarkIds: [''] }, // whitespace only id
        { name: 'Valid 3', bookmarkIds: ['ok'], folderId: '  ' }, // empty folderId stripped
        { name: 'Valid 4', bookmarkIds: ['ok4'], folderId: 'valid-id' },
      ],
    };
    expect(parseTopicOrganizeJson(mixed)).toEqual([
      { name: 'Valid 3', bookmarkIds: ['ok'] },
      { name: 'Valid 4', bookmarkIds: ['ok4'], folderId: 'valid-id' },
    ]);
  });
});

describe('topicProposalFromModel end-to-end integration', () => {
  test('sanitizes markdown-fenced model response into a valid proposal', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([
      page('b1', 'https://github.com/facebook/react', '2', 'React'),
      page('b2', 'https://github.com/vuejs/core', '2', 'Vue'),
    ]));

    const markdownResponse = `\`\`\`json
{
  "groups": [
    { "name": "Frontend Frameworks", "bookmarkIds": ["b1", "b2"] }
  ]
}
\`\`\``;

    const proposal = topicProposalFromModel(markdownResponse, bookmarks, folders, 'unfiled');
    expect(proposal.clusters).toHaveLength(1);
    expect(proposal.clusters[0].folderTitle).toBe('Frontend Frameworks');
    expect(proposal.clusters[0].bookmarkIds).toEqual(['b1', 'b2']);
    expect(proposal.moves).toHaveLength(2);
  });

  test('topicProposalFromModel yields empty groups for garbage', () => {
    const { bookmarks, folders } = flattenBookmarkTree(tree([page('a', 'https://a.example/', '2')]));
    expect(topicProposalFromModel(null, bookmarks, folders).clusters).toEqual([]);
    expect(topicProposalFromModel({ nope: true }, bookmarks, folders).clusters).toEqual([]);
    expect(topicProposalFromModel('garbage', bookmarks, folders).clusters).toEqual([]);
  });
});
