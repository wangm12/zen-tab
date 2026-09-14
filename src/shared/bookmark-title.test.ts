import { describe, expect, test } from 'vitest';
import {
  cleanBookmarkTitle,
  extractTitleKeywords,
  formatKeywordFolderTitle,
  titleFolderMatchScore,
} from './bookmark-title';

describe('cleanBookmarkTitle', () => {
  test('strips leading notification counters and brackets', () => {
    expect(cleanBookmarkTitle('(1) 我的个人主页')).toBe('我的个人主页');
    expect(cleanBookmarkTitle('(99+) Messages - Slack')).toBe('Messages - Slack');
    expect(cleanBookmarkTitle('【置顶】深入浅出 TypeScript')).toBe('深入浅出 TypeScript');
    expect(cleanBookmarkTitle('[精选] 2024 年前端路线图')).toBe('2024 年前端路线图');
    expect(cleanBookmarkTitle('(3) 【精选】[推荐] 现代化 Web 架构')).toBe('现代化 Web 架构');
  });

  test('preserves the title if it only contains bracketed text', () => {
    expect(cleanBookmarkTitle('[React]')).toBe('React');
    expect(cleanBookmarkTitle('【前端开发】')).toBe('前端开发');
  });

  test('strips platform suffixes in Chinese and English', () => {
    expect(cleanBookmarkTitle('Awesome React - YouTube')).toBe('Awesome React');
    expect(cleanBookmarkTitle('TypeScript 5.0 发布 | 掘金')).toBe('TypeScript 5.0 发布');
    expect(cleanBookmarkTitle('antigravity · GitHub')).toBe('antigravity');
    expect(cleanBookmarkTitle('二叉树遍历 - 哔哩哔哩')).toBe('二叉树遍历');
    expect(cleanBookmarkTitle('黑神话悟空全流程攻略_哔哩哔哩_bilibili')).toBe('黑神话悟空全流程攻略');
    expect(cleanBookmarkTitle('如何评价前端现状 - 知乎')).toBe('如何评价前端现状');
    expect(cleanBookmarkTitle('量子力学 - 维基百科')).toBe('量子力学');
    expect(cleanBookmarkTitle('How to center a div - Stack Overflow')).toBe('How to center a div');
    expect(cleanBookmarkTitle('vite vs turbopack - Google Search')).toBe('vite vs turbopack');
    expect(cleanBookmarkTitle('深入理解 Python GIL - 简书')).toBe('深入理解 Python GIL');
    expect(cleanBookmarkTitle('Spring Boot 最佳实践 | CSDN')).toBe('Spring Boot 最佳实践');
    expect(cleanBookmarkTitle('关于远程工作的思考 | V2EX')).toBe('关于远程工作的思考');
    expect(cleanBookmarkTitle('Vue3 响应式原理 - SegmentFault 思否')).toBe('Vue3 响应式原理');
  });

  test('strips host-derived brand suffixes when url is provided', () => {
    expect(cleanBookmarkTitle('React 19 Release Notes - React', 'https://react.dev/blog/19'))
      .toBe('React 19 Release Notes');
    expect(cleanBookmarkTitle('Documentation · react.dev', 'https://react.dev/docs'))
      .toBe('Documentation');
  });

  test('preserves standalone platform names when title is only the brand', () => {
    expect(cleanBookmarkTitle('YouTube')).toBe('YouTube');
    expect(cleanBookmarkTitle('GitHub')).toBe('GitHub');
    expect(cleanBookmarkTitle('知乎')).toBe('知乎');
  });

  test('normalizes internal and trailing whitespace', () => {
    expect(cleanBookmarkTitle('  Hello   World   -   YouTube  ')).toBe('Hello World');
  });
});

describe('extractTitleKeywords', () => {
  test('extracts keywords from mixed Chinese/English titles', () => {
    const react19 = extractTitleKeywords('深入浅出 React 19 技术栈');
    expect(react19).toContain('深入');
    expect(react19).toContain('react');
    expect(react19).toContain('技术');
    expect(react19).not.toContain('19');

    const dockerK8s = extractTitleKeywords('Docker 与 Kubernetes 实践指南');
    expect(dockerK8s).toEqual(['docker', 'kubernetes', '实践', '指南']);

    const leetcode = extractTitleKeywords('LeetCode 算法面试总结');
    expect(leetcode).toEqual(['leetcode', '算法', '面试', '总结']);
  });

  test('filters out common Chinese and English stop words', () => {
    const result = extractTitleKeywords('The official website and page for React and Vue');
    expect(result).toEqual(['react', 'vue']);

    const cnResult = extractTitleKeywords('这是一篇关于 React 架构的深度分析');
    expect(cnResult).toEqual(['react', '架构', '深度', '分析']);
  });

  test('enforces minimum token length (>= 2 for CJK, >= 3 for Latin, or whitelisted acronyms)', () => {
    // Single CJK char like '中' or '看' should be excluded
    const shortCjk = extractTitleKeywords('看 书 读 报');
    expect(shortCjk).toEqual([]);

    // Latin tokens < 3 chars that are NOT in SHORT_TECH_ACRONYMS are excluded
    const nonAcronymShort = extractTitleKeywords('JS to in on at');
    expect(nonAcronymShort).toEqual([]);

    // Whitelisted 2-letter tech acronyms like ai, ui, ml are extracted
    const techAcronyms = extractTitleKeywords('AI UI ML UX DB OS');
    expect(techAcronyms).toEqual(['ai', 'ui', 'ml', 'ux', 'db', 'os']);

    // Valid Latin >= 3 chars
    const validLatin = extractTitleKeywords('Vue Git CSS API SQL');
    expect(validLatin).toEqual(['vue', 'git', 'css', 'api', 'sql']);
  });

  test('returns unique lowercase tokens', () => {
    const result = extractTitleKeywords('React react REACT React-Hooks');
    expect(result).toEqual(['react', 'hooks']);
  });
});

describe('formatKeywordFolderTitle', () => {
  test('preserves original casing from sample titles', () => {
    expect(formatKeywordFolderTitle('leetcode', ['LeetCode 算法面试总结'])).toBe('LeetCode');
    expect(formatKeywordFolderTitle('react', ['深入浅出 React 19 技术栈'])).toBe('React');
    expect(formatKeywordFolderTitle('kubernetes', ['Docker 与 Kubernetes 实践指南'])).toBe('Kubernetes');
  });

  test('capitalizes first letter if no sample title provided', () => {
    expect(formatKeywordFolderTitle('docker')).toBe('Docker');
    expect(formatKeywordFolderTitle('algorithms')).toBe('Algorithms');
  });

  test('keeps CJK keywords intact', () => {
    expect(formatKeywordFolderTitle('算法', ['LeetCode 算法面试总结'])).toBe('算法');
    expect(formatKeywordFolderTitle('面试')).toBe('面试');
  });
});

describe('titleFolderMatchScore', () => {
  test('matches exact keyword against folder title', () => {
    const score = titleFolderMatchScore('React 19 Release Notes', ['react', 'release', 'notes'], 'React');
    expect(score).toBeGreaterThan(100);
  });

  test('matches CJK folder title in title string', () => {
    const score = titleFolderMatchScore('Web 前端开发指南', ['前端', '开发', '指南'], '前端开发');
    expect(score).toBeGreaterThan(80);
  });

  test('returns 0 for unrelated folders or stop words', () => {
    expect(titleFolderMatchScore('React 19 Release Notes', ['react'], 'Inbox')).toBe(0);
    expect(titleFolderMatchScore('React 19 Release Notes', ['react'], 'Python')).toBe(0);
  });

  test('matches 2-letter tech acronym folders like AI', () => {
    // Exact keyword match
    const exactScore = titleFolderMatchScore('AI ChatBot Assistant', ['ai', 'chatbot', 'assistant'], 'AI');
    expect(exactScore).toBeGreaterThan(100);

    // Title substring match
    const subScore = titleFolderMatchScore('Building with AI Tools', ['tools'], 'AI');
    expect(subScore).toBeGreaterThan(80);

    // Multi-keyword folder match e.g. "AI Tools"
    const multiScore = titleFolderMatchScore('The Best AI Tools for Coding', ['ai', 'tools', 'coding'], 'AI Tools');
    expect(multiScore).toBeGreaterThan(70);

    // Non-acronym 1-2 letter folders are rejected
    expect(titleFolderMatchScore('About Something', ['about', 'something'], 'A')).toBe(0);
    expect(titleFolderMatchScore('To Do List', ['list'], 'To')).toBe(0);
  });
});
