import { getHostname, isSpecialUrl } from './url';

export const DUPLICATE_REDIRECT_GRACE_MS = 200;

export type DuplicateCompareInput = {
  url: string;
  canonicalUrl: string | null;
  pinned: boolean;
  incognito: boolean;
  status?: chrome.tabs.Tab['status'] | string;
};

export type DuplicateSettings = {
  duplicateEnabled: boolean;
  duplicateScope: 'same-window' | 'all-normal-windows';
  ignoredDomains: string[];
  incognitoEnabled: boolean;
};

export type DuplicateCandidate = {
  tabId: number;
  windowId: number;
  pinned: boolean;
  lastAccessed?: number;
  createdAt: number;
  canonicalUrl: string | null;
  url: string;
};

const DUPLICATE_REDIRECT_PATTERN = /(?:oauth|authorize|callback|login-success|logged-in|redirect)/i;

function isIgnoredHost(url: string, ignoredDomains: string[]): boolean {
  const host = getHostname(url);
  return ignoredDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function canCompareDuplicate(tab: DuplicateCompareInput, settings: DuplicateSettings): boolean {
  if (!settings.duplicateEnabled || !tab.canonicalUrl || tab.pinned || isSpecialUrl(tab.url) || isIgnoredHost(tab.url, settings.ignoredDomains)) {
    return false;
  }
  if (tab.incognito && !settings.incognitoEnabled) return false;
  return true;
}

export function isDuplicateRedirectUrl(url: string): boolean {
  return DUPLICATE_REDIRECT_PATTERN.test(url);
}

export function shouldDeferDuplicateCheck(tab: DuplicateCompareInput): boolean {
  if (!tab.url) return true;
  if (tab.url === 'about:blank') return true;
  if (!tab.canonicalUrl) return true;
  if (isDuplicateRedirectUrl(tab.url)) return true;
  return false;
}

export function pickDuplicateCandidate(
  newTab: DuplicateCandidate & { tabId: number; windowId: number },
  others: DuplicateCandidate[],
  settings: DuplicateSettings,
): DuplicateCandidate | undefined {
  if (!newTab.canonicalUrl) return undefined;

  const candidates = others
    .filter((tab) => tab.tabId !== newTab.tabId && tab.canonicalUrl && !isSpecialUrl(tab.url) && !isIgnoredHost(tab.url, settings.ignoredDomains))
    .filter((tab) => settings.duplicateScope === 'all-normal-windows' || tab.windowId === newTab.windowId);

  candidates.sort((left, right) => {
    const pinnedScore = Number(right.pinned) - Number(left.pinned);
    if (pinnedScore) return pinnedScore;
    const sameWindowScore = Number(right.windowId === newTab.windowId) - Number(left.windowId === newTab.windowId);
    if (sameWindowScore) return sameWindowScore;
    return (right.lastAccessed ?? right.createdAt) - (left.lastAccessed ?? left.createdAt);
  });

  return candidates[0];
}

export function isRedirectGraceElapsed(lastUrlChangeAt: number | undefined, now: number): boolean {
  if (lastUrlChangeAt == null) return false;
  return now - lastUrlChangeAt >= DUPLICATE_REDIRECT_GRACE_MS;
}
