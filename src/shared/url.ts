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

export function extractProjectTokens(input: { title: string; url: string; summary?: string }): string[] {
  const source = `${input.title} ${input.title} ${input.url} ${input.summary ?? ''}`
    .replace(/[/?#=&%_.:+\-()[\]{}"'`,;|]+/g, ' ')
    .replace(/\b\d{5,}\b/g, ' ')
    .toLowerCase();

  const tokens = source
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token) && !/^[0-9]+$/.test(token));

  return [...new Set(tokens)];
}

export function displayHostname(rawUrl: string): string {
  const hostname = getHostname(rawUrl).replace(/^www\./, '');
  return hostname || 'New tab';
}
