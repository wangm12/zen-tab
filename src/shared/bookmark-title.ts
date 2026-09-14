import { getHostname } from './url';

const PLATFORM_NAMES = [
  'YouTube',
  '掘金',
  'GitHub',
  '哔哩哔哩',
  'bilibili',
  '知乎',
  '知乎专栏',
  '维基百科',
  '维基百科，自由的百科全书',
  'Wikipedia',
  'Stack Overflow',
  'Google Search',
  'Google 搜索',
  '简书',
  'CSDN',
  'CSDN博客',
  'V2EX',
  'SegmentFault 思否',
  'SegmentFault',
  '思否',
  '少数派',
  '微信读书',
  '豆瓣',
  'Reddit',
  'Twitter',
  'X',
  'Medium',
  'Substack',
  '博客园',
  '开源中国',
  'OSCHINA',
  '百度',
  '百度搜索',
];

const ESCAPED_PLATFORMS = PLATFORM_NAMES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

const PLATFORM_SUFFIX_REGEX = new RegExp(
  `(?:(?:\\s*[-_|·–—/:]\\s*|\\s*\\|\\s*)(?:${ESCAPED_PLATFORMS})|_哔哩哔哩_bilibili|_bilibili)\\s*$`,
  'i',
);

const GENERIC_HOST_LABELS = new Set([
  'www', 'com', 'org', 'net', 'edu', 'gov', 'io', 'co', 'app', 'dev', 'ai', 'so', 'me', 'info', 'xyz',
  'cn', 'jp', 'uk', 'de', 'cc', 'tv', 'us',
]);

const STOP_WORDS = new Set([
  // Chinese stop words
  '的', '了', '和', '是', '在', '我', '有', '就', '不', '人', '都', '一', '一个', '一篇', '一些', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '这个', '这些', '那', '那个', '那些',
  '与', '或', '及', '等', '之', '其', '并', '更', '把', '被', '让', '从', '向', '为', '对', '但', '而', '已', '最', '新', '中', '做', '给', '内', '外', '前', '后', '下', '来', '过', '得', '以', '所', '它', '他', '她', '们', '么', '怎么', '怎样', '如何', '关于',
  // English stop words
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'how', 'what', 'why', 'where', 'can', 'about', 'into', 'over', 'after', 'your', 'official', 'site', 'website', 'page', 'home',
  'you', 'are', 'not', 'all', 'any', 'our', 'out', 'new', 'more', 'get', 'use', 'using', 'via', 'com', 'org', 'net', 'www', 'http', 'https',
  'one', 'two', 'three', 'four', 'five', 'only', 'board', 'root', 'sub', 'solo', 'demo', 'test', 'example', 'temp', 'misc', 'folder',
]);

const CJK_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function isCjkWord(word: string): boolean {
  return CJK_REGEX.test(word);
}

export function cleanBookmarkTitle(title: string, url?: string): string {
  let cleaned = title.trim();

  // 1. Strip leading notification numbers and brackets: e.g. ^(?:\(\d+\)|【[^】]+】|\[[^\]]+\])\s*
  while (true) {
    const match = cleaned.match(/^(?:\(\d+\+?\)|【[^】]*】|\[[^\]]*\])\s*/);
    if (!match) break;
    const next = cleaned.slice(match[0].length).trim();
    if (next.length === 0) {
      const inner = cleaned.replace(/^[[【(](.*?)[\]】)]$/, '$1').trim();
      if (inner.length > 0) cleaned = inner;
      break;
    }
    cleaned = next;
  }

  // 2. Strip common platform suffixes
  const strippedPlatform = cleaned.replace(PLATFORM_SUFFIX_REGEX, '').trim();
  if (strippedPlatform.length > 0) {
    cleaned = strippedPlatform;
  }

  // 3. Strip host-derived brand suffixes if url provided
  if (url) {
    try {
      const host = getHostname(url).replace(/^www\./, '');
      if (host) {
        const parts = host.split('.').filter(Boolean);
        const candidates = [host, ...parts.filter((part) => part.length >= 2 && !GENERIC_HOST_LABELS.has(part.toLowerCase()))];
        for (const brand of candidates) {
          const brandRegex = new RegExp(`(?:\\s*[-_|·–—/:]\\s*|\\s*\\|\\s*)${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
          const strippedBrand = cleaned.replace(brandRegex, '').trim();
          if (strippedBrand.length > 0) {
            cleaned = strippedBrand;
          }
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
  }

  // 4. Strip trailing dangling separators if any
  cleaned = cleaned.replace(/\s*[-_|·–—/:]+$/, '').trim();

  // 5. Trim and normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim();
}

export const SHORT_TECH_ACRONYMS = new Set([
  'ai', 'ui', 'ux', 'ml', 'os', 'db', 'vr', 'ar', 'io', 'pr', 'qa', 'ci', 'cd', 'ip', 'id', '3d', '2d', 'go',
]);

export function extractTitleKeywords(title: string): string[] {
  if (!title) return [];
  const segmenter = new Intl.Segmenter(['zh', 'en'], { granularity: 'word' });
  const results: string[] = [];

  for (const { segment, isWordLike } of segmenter.segment(title)) {
    if (!isWordLike) continue;
    const lower = segment.trim().toLowerCase();
    if (!lower) continue;
    if (/^\d+$/.test(lower)) continue;
    if (STOP_WORDS.has(lower)) continue;

    if (isCjkWord(lower)) {
      if (lower.length < 2) continue;
    } else {
      if (lower.length < 3 && !SHORT_TECH_ACRONYMS.has(lower)) continue;
    }

    results.push(lower);
  }

  return Array.from(new Set(results));
}

export function formatKeywordFolderTitle(keyword: string, sampleTitles?: string[]): string {
  if (sampleTitles) {
    for (const title of sampleTitles) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = title.match(new RegExp(`(?:^|[^a-zA-Z0-9])(${escaped})(?:[^a-zA-Z0-9]|$)`, 'i'));
      if (match && match[1]) {
        return match[1];
      }
    }
  }
  if (!keyword) return '';
  if (SHORT_TECH_ACRONYMS.has(keyword)) {
    return keyword.toUpperCase();
  }
  return keyword.charAt(0).toUpperCase() + keyword.slice(1);
}

export function titleFolderMatchScore(
  cleanTitle: string,
  keywords: string[],
  folderTitle: string,
): number {
  const folderNorm = folderTitle.trim().toLowerCase().replace(/\s+/g, '');
  if (!folderNorm || folderNorm === 'inbox') return 0;
  if (STOP_WORDS.has(folderNorm)) return 0;
  if (!isCjkWord(folderNorm) && folderNorm.length < 3 && !SHORT_TECH_ACRONYMS.has(folderNorm)) {
    return 0;
  }

  const titleNorm = cleanTitle.trim().toLowerCase().replace(/\s+/g, '');

  // Exact keyword match: e.g. folder is "React" or "算法", and keywords contains it
  if (keywords.includes(folderNorm)) {
    return 100 + folderNorm.length * 2;
  }

  // Check if title contains the folder name
  if (isCjkWord(folderNorm)) {
    if (folderNorm.length >= 2 && titleNorm.includes(folderNorm)) {
      return 80 + folderNorm.length * 2;
    }
  } else {
    const escaped = folderTitle.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i').test(cleanTitle)) {
      return 80 + folderNorm.length * 2;
    }
  }

  // Check multi-keyword match: e.g. folder "Machine Learning"
  const folderKw = extractTitleKeywords(folderTitle);
  if (folderKw.length >= 2 && folderKw.every((k) => keywords.includes(k))) {
    return 70 + folderKw.length * 10;
  }

  return 0;
}
