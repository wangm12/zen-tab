import { isLocalAddress, isSpecialUrl } from './url';
import { AutoDiscardMinutes, ZenTabSettings } from './types';

export const AUTO_DISCARD_MINUTES: AutoDiscardMinutes[] = [15, 30, 60, 120];

export type DiscardableTab = {
  discarded: boolean;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  lastAccessed?: number;
  url: string;
};

function isProtectedHost(url: string, protectedDomains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return protectedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function shouldAutoDiscard(tab: DiscardableTab, settings: ZenTabSettings, now: number): boolean {
  if (!settings.autoDiscardEnabled) return false;
  if (tab.discarded || tab.pinned || tab.active || tab.audible) return false;
  if (isSpecialUrl(tab.url) || isLocalAddress(tab.url) || isProtectedHost(tab.url, settings.protectedDomains)) return false;
  const lastAccessed = tab.lastAccessed ?? 0;
  return now - lastAccessed >= settings.autoDiscardMinutes * 60_000;
}

export function shouldSkipDiscardAfterInspect(options: {
  inspectEnabled: boolean;
  hasPermission: boolean;
  inspectProtected: boolean;
}): boolean {
  if (!options.inspectEnabled) return false;
  if (!options.hasPermission || options.inspectProtected) return true;
  return false;
}
