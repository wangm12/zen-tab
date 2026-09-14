const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'ref_src',
  'affiliate',
  'campaign_id',
  'utm_campaign',
  'utm_content',
  'utm_medium',
  'utm_source',
  'utm_term',
]);

const IGNORED_PROTOCOLS = new Set(['chrome:', 'chrome-extension:', 'file:', 'data:', 'blob:', 'about:']);

export function canonicalizeUrl(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (IGNORED_PROTOCOLS.has(parsed.protocol)) return null;

    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
      parsed.port = '';
    }

    parsed.hash = '';
    const kept = [...parsed.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([aKey, aValue], [bKey, bValue]) => `${aKey}=${aValue}`.localeCompare(`${bKey}=${bValue}`));
    parsed.search = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';

    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

export function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const TWO_LEVEL_PUBLIC_SUFFIXES = new Set([
  'co.uk',
  'com.cn',
  'net.cn',
  'org.cn',
  'edu.cn',
  'gov.cn',
  'co.jp',
  'ne.jp',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.tw',
  'org.tw',
  'com.hk',
  'org.hk',
  'com.sg',
  'co.in',
  'com.br',
  'github.io',
  'gitlab.io',
  'pages.dev',
  'vercel.app',
  'netlify.app',
]);

export function rootDomainFromHost(host: string): string {
  const cleaned = host.trim().toLowerCase().replace(/^www\./, '');
  if (!cleaned) return '';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cleaned) || cleaned.includes(':')) {
    return cleaned;
  }
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length <= 2) return cleaned;

  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function isLocalAddress(rawUrl: string): boolean {
  const hostname = getHostname(rawUrl);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.endsWith('.local');
}

export function isSpecialUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return true;
  return !canonicalizeUrl(rawUrl);
}

const STOP_WORDS = new Set([
  'www', 'com', 'org', 'net', 'http', 'https', 'html', 'page', 'view', 'search', 'google', 'github',
  'docs', 'home', 'index', 'the', 'and', 'for', 'with', 'from', 'this', 'that', 'new', 'login',
]);

function tokenize(source: string): string[] {
  return source
    .replace(/[/?#=&%_.:+\-()[\]{}"'`,;|]+/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^[0-9]+$/.test(token));
}

export function hostTokensFromUrl(rawUrl: string): Set<string> {
  const hostname = getHostname(rawUrl).replace(/^www\./, '');
  return new Set(tokenize(hostname.replace(/\./g, ' ')));
}

export function extractProjectTokens(input: { title: string; url: string; summary?: string }): string[] {
  return [...new Set(tokenize(`${input.title} ${input.title} ${input.url} ${input.summary ?? ''}`))];
}

export function displayHostname(rawUrl: string): string {
  const hostname = getHostname(rawUrl).replace(/^www\./, '');
  return hostname || 'New tab';
}
