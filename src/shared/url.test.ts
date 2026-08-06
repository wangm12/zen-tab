import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractProjectTokens, isLocalAddress, isSpecialUrl } from './url';

describe('canonicalizeUrl', () => {
  it('removes tracking noise, fragments, and a trailing slash', () => {
    expect(canonicalizeUrl('HTTPS://Example.com/docs/?utm_source=newsletter&ref=home#intro')).toBe('https://example.com/docs');
  });

  it('keeps business query parameters while normalizing their order', () => {
    expect(canonicalizeUrl('https://example.com/item?sku=42&utm_medium=email&color=blue')).toBe('https://example.com/item?color=blue&sku=42');
  });

  it('does not compare special browser URLs', () => {
    expect(canonicalizeUrl('chrome://settings')).toBeNull();
    expect(isSpecialUrl('chrome://settings')).toBe(true);
  });
});

describe('tab safety and project signals', () => {
  it('recognizes local development hosts', () => {
    expect(isLocalAddress('http://localhost:3000/app')).toBe(true);
    expect(isLocalAddress('https://example.com/app')).toBe(false);
  });

  it('extracts cross-site project tokens without requiring a shared hostname', () => {
    const tokens = extractProjectTokens({
      title: 'Zen Tab PRD review',
      url: 'https://github.com/acme/zen-tab/issues/42',
      summary: 'Chrome extension project context and performance plan',
    });
    expect(tokens).toEqual(expect.arrayContaining(['zen', 'tab', 'prd', 'review', 'acme', 'performance', 'plan']));
    expect(tokens).not.toContain('github');
  });
});
