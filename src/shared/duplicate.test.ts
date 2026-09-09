import { describe, expect, it } from 'vitest';
import {
  canCompareDuplicate,
  DUPLICATE_REDIRECT_GRACE_MS,
  isDuplicateRedirectUrl,
  isRedirectGraceElapsed,
  pickDuplicateCandidate,
  shouldDeferDuplicateCheck,
  type DuplicateCandidate,
  type DuplicateSettings,
} from './duplicate';

const baseSettings: DuplicateSettings = {
  duplicateEnabled: true,
  duplicateScope: 'all-normal-windows',
  ignoredDomains: ['example.org'],
  incognitoEnabled: false,
};

const normalTab = {
  url: 'https://example.com/docs',
  canonicalUrl: 'https://example.com/docs',
  pinned: false,
  incognito: false,
};

describe('canCompareDuplicate', () => {
  it('returns true for an enabled normal https tab', () => {
    expect(canCompareDuplicate(normalTab, baseSettings)).toBe(true);
  });

  it('returns false when duplicate guard is disabled', () => {
    expect(canCompareDuplicate(normalTab, { ...baseSettings, duplicateEnabled: false })).toBe(false);
  });

  it('returns false for pinned tabs', () => {
    expect(canCompareDuplicate({ ...normalTab, pinned: true }, baseSettings)).toBe(false);
  });

  it('returns false for chrome:// URLs', () => {
    expect(canCompareDuplicate({
      ...normalTab,
      url: 'chrome://extensions',
      canonicalUrl: null,
    }, baseSettings)).toBe(false);
  });

  it('returns false for ignored hosts', () => {
    expect(canCompareDuplicate({
      ...normalTab,
      url: 'https://mail.example.org/inbox',
      canonicalUrl: 'https://mail.example.org/inbox',
    }, baseSettings)).toBe(false);
  });

  it('returns false for incognito tabs when incognito is not enabled', () => {
    expect(canCompareDuplicate({ ...normalTab, incognito: true }, baseSettings)).toBe(false);
  });

  it('returns false when canonicalUrl is missing', () => {
    expect(canCompareDuplicate({ ...normalTab, canonicalUrl: null }, baseSettings)).toBe(false);
  });
});

describe('shouldDeferDuplicateCheck', () => {
  it('defers about:blank, empty url, and oauth/callback URLs', () => {
    expect(shouldDeferDuplicateCheck({
      ...normalTab,
      url: 'about:blank',
      canonicalUrl: null,
    })).toBe(true);

    expect(shouldDeferDuplicateCheck({
      ...normalTab,
      url: '',
      canonicalUrl: null,
    })).toBe(true);

    expect(shouldDeferDuplicateCheck({
      ...normalTab,
      url: 'https://auth.example.com/oauth/callback?code=abc',
      canonicalUrl: 'https://auth.example.com/oauth/callback',
    })).toBe(true);
  });

  it('does not defer a loading https page with a stable canonical URL', () => {
    expect(shouldDeferDuplicateCheck({
      ...normalTab,
      status: 'loading',
    })).toBe(false);
  });
});

describe('isDuplicateRedirectUrl', () => {
  it('matches oauth and callback patterns', () => {
    expect(isDuplicateRedirectUrl('https://auth.example.com/oauth/authorize')).toBe(true);
    expect(isDuplicateRedirectUrl('https://app.example.com/login-success')).toBe(true);
    expect(isDuplicateRedirectUrl('https://example.com/docs')).toBe(false);
  });
});

describe('pickDuplicateCandidate', () => {
  const newTab: DuplicateCandidate = {
    tabId: 100,
    windowId: 1,
    pinned: false,
    createdAt: 500,
    canonicalUrl: 'https://example.com/docs',
    url: 'https://example.com/docs',
  };

  const otherWindow: DuplicateCandidate = {
    tabId: 1,
    windowId: 2,
    pinned: false,
    lastAccessed: 400,
    createdAt: 100,
    canonicalUrl: 'https://example.com/docs',
    url: 'https://example.com/docs',
  };

  const sameWindowOlder: DuplicateCandidate = {
    tabId: 2,
    windowId: 1,
    pinned: false,
    lastAccessed: 300,
    createdAt: 200,
    canonicalUrl: 'https://example.com/docs',
    url: 'https://example.com/docs',
  };

  const sameWindowNewer: DuplicateCandidate = {
    tabId: 3,
    windowId: 1,
    pinned: false,
    lastAccessed: 900,
    createdAt: 250,
    canonicalUrl: 'https://example.com/docs',
    url: 'https://example.com/docs',
  };

  const pinnedCandidate: DuplicateCandidate = {
    tabId: 4,
    windowId: 2,
    pinned: true,
    lastAccessed: 50,
    createdAt: 50,
    canonicalUrl: 'https://example.com/docs',
    url: 'https://example.com/docs',
  };

  it('prefers pinned, then same window, then more recently accessed', () => {
    expect(pickDuplicateCandidate(newTab, [otherWindow, sameWindowOlder, sameWindowNewer, pinnedCandidate], baseSettings))
      .toEqual(pinnedCandidate);

    expect(pickDuplicateCandidate(newTab, [otherWindow, sameWindowOlder, sameWindowNewer], baseSettings))
      .toEqual(sameWindowNewer);

    expect(pickDuplicateCandidate(newTab, [otherWindow, sameWindowOlder], baseSettings))
      .toEqual(sameWindowOlder);
  });

  it('respects same-window scope', () => {
    const sameWindowSettings = { ...baseSettings, duplicateScope: 'same-window' as const };
    expect(pickDuplicateCandidate(newTab, [otherWindow, sameWindowOlder], sameWindowSettings))
      .toEqual(sameWindowOlder);
    expect(pickDuplicateCandidate(newTab, [otherWindow], sameWindowSettings)).toBeUndefined();
  });

  it('excludes the new tab, special URLs, and ignored hosts', () => {
    expect(pickDuplicateCandidate(newTab, [newTab], baseSettings)).toBeUndefined();
    expect(pickDuplicateCandidate(newTab, [{
      ...sameWindowNewer,
      url: 'chrome://extensions',
      canonicalUrl: null,
    }], baseSettings)).toBeUndefined();
    expect(pickDuplicateCandidate(newTab, [{
      ...sameWindowNewer,
      tabId: 5,
      url: 'https://mail.example.org/inbox',
      canonicalUrl: 'https://mail.example.org/inbox',
    }], baseSettings)).toBeUndefined();
  });
});

describe('isRedirectGraceElapsed', () => {
  const now = 10_000;

  it('returns false when lastUrlChangeAt is undefined', () => {
    expect(isRedirectGraceElapsed(undefined, now)).toBe(false);
  });

  it(`returns false before ${DUPLICATE_REDIRECT_GRACE_MS}ms and true at or after`, () => {
    expect(isRedirectGraceElapsed(now - 199, now)).toBe(false);
    expect(isRedirectGraceElapsed(now - DUPLICATE_REDIRECT_GRACE_MS, now)).toBe(true);
  });
});
