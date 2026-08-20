import { describe, expect, it } from 'vitest';
import { shouldAutoDiscard, shouldSkipDiscardAfterInspect } from './discard';
import { DEFAULT_SETTINGS } from './types';

const baseTab = {
  discarded: false,
  pinned: false,
  active: false,
  audible: false,
  lastAccessed: 1_000,
  url: 'https://example.com/article',
};

describe('auto-discard eligibility', () => {
  it('discards idle unpinned tabs once the idle threshold has passed', () => {
    expect(shouldAutoDiscard(baseTab, {
      ...DEFAULT_SETTINGS,
      autoDiscardEnabled: true,
      autoDiscardMinutes: 30,
    }, 1_000 + 30 * 60_000)).toBe(true);
  });

  it('never discards when the setting is off, or the tab is active, pinned, audible, already discarded, local, or protected', () => {
    const now = 1_000 + 120 * 60_000;
    const enabled = { ...DEFAULT_SETTINGS, autoDiscardEnabled: true, autoDiscardMinutes: 15 as const };
    expect(shouldAutoDiscard(baseTab, { ...enabled, autoDiscardEnabled: false }, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, active: true }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, pinned: true }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, audible: true }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, discarded: true }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, url: 'http://localhost:3000' }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, url: 'https://docs.google.com/doc' }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, url: 'chrome://extensions' }, enabled, now)).toBe(false);
    expect(shouldAutoDiscard({ ...baseTab, lastAccessed: now - 60_000 }, enabled, now)).toBe(false);
  });
});

describe('auto-discard page inspection', () => {
  it('does not skip discard when inspection is off', () => {
    expect(shouldSkipDiscardAfterInspect({ inspectEnabled: false, hasPermission: false, inspectProtected: true })).toBe(false);
  });

  it('fails closed when inspection is on but page-access permission is missing', () => {
    expect(shouldSkipDiscardAfterInspect({ inspectEnabled: true, hasPermission: false, inspectProtected: false })).toBe(true);
  });

  it('skips dirty or unverifiable pages and discards only verified-safe pages', () => {
    expect(shouldSkipDiscardAfterInspect({ inspectEnabled: true, hasPermission: true, inspectProtected: true })).toBe(true);
    expect(shouldSkipDiscardAfterInspect({ inspectEnabled: true, hasPermission: true, inspectProtected: false })).toBe(false);
  });
});
