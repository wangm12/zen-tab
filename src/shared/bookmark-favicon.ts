import { canonicalizeUrl } from './url';

export const BOOKMARK_WORKSPACE_PERMISSIONS = { permissions: ['bookmarks', 'favicon'] };
export const FAVICON_PERMISSIONS = { permissions: ['favicon'] };

export async function readFaviconGranted(
  contains: (details: { permissions: string[] }) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await contains(FAVICON_PERMISSIONS);
  } catch {
    return false;
  }
}

export function chromeFaviconUrl(pageUrl: string, getURL: (path: string) => string): string {
  const url = new URL(getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '16');
  return url.toString();
}

export function resolveBookmarkFavicon(
  url: string,
  openTabs: Array<{ url: string; favIconUrl?: string }>,
  chromeFaviconUrl?: string | undefined,
): string | undefined {
  const canonical = canonicalizeUrl(url);
  const tabIcon = canonical
    ? openTabs.find((tab) => canonicalizeUrl(tab.url) === canonical && tab.favIconUrl)?.favIconUrl
    : undefined;
  return tabIcon || chromeFaviconUrl || undefined;
}
