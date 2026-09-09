import { describe, expect, test, vi } from 'vitest';
import {
  BOOKMARK_WORKSPACE_PERMISSIONS,
  chromeFaviconUrl,
  readFaviconGranted,
  resolveBookmarkFavicon,
} from './bookmark-favicon';

describe('chromeFaviconUrl', () => {
  test('builds official _favicon URL with pageUrl and size 16', () => {
    expect(chromeFaviconUrl('https://example.com/docs', (path) => `chrome-extension://abc${path}`))
      .toBe('chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fexample.com%2Fdocs&size=16');
  });
});

describe('resolveBookmarkFavicon', () => {
  test('tab match', () => {
    expect(resolveBookmarkFavicon(
      'https://example.com/docs',
      [
        { url: 'https://other.example/page', favIconUrl: 'https://other.example/icon.png' },
        { url: 'https://example.com/docs', favIconUrl: 'https://example.com/favicon.ico' },
      ],
      'chrome://favicon/https://example.com/docs',
    )).toBe('https://example.com/favicon.ico');
  });

  test('tracking-param URL still matches', () => {
    expect(resolveBookmarkFavicon(
      'https://example.com/docs?utm_source=newsletter&utm_medium=email',
      [{ url: 'https://example.com/docs#intro', favIconUrl: 'https://example.com/icon.png' }],
    )).toBe('https://example.com/icon.png');
  });

  test('fallback to chrome url', () => {
    expect(resolveBookmarkFavicon(
      'https://example.com/docs',
      [{ url: 'https://other.example/page', favIconUrl: 'https://other.example/icon.png' }],
      'chrome://favicon/size/16@2x/https://example.com/docs',
    )).toBe('chrome://favicon/size/16@2x/https://example.com/docs');
  });

  test('no match → undefined', () => {
    expect(resolveBookmarkFavicon(
      'https://example.com/docs',
      [{ url: 'https://other.example/page', favIconUrl: 'https://other.example/icon.png' }],
    )).toBeUndefined();
  });
});

describe('favicon permission read/grant', () => {
  test('workspace grant asks for bookmarks and favicon together', () => {
    expect(BOOKMARK_WORKSPACE_PERMISSIONS).toEqual({ permissions: ['bookmarks', 'favicon'] });
  });

  test('read path only contains favicon and stays false when contains throws', async () => {
    const contains = vi.fn().mockResolvedValue(true);
    await expect(readFaviconGranted(contains)).resolves.toBe(true);
    expect(contains).toHaveBeenCalledTimes(1);
    expect(contains).toHaveBeenCalledWith({ permissions: ['favicon'] });

    const failing = vi.fn().mockRejectedValue(new Error('not granted'));
    await expect(readFaviconGranted(failing)).resolves.toBe(false);
  });
});
