import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractProjectTokens, hostTokensFromUrl, isLocalAddress, isSpecialUrl, rootDomainFromHost } from './url';

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

  it('treats product hostnames as weak host tokens', () => {
    expect([...hostTokensFromUrl('https://www.notion.so/hiring-plan')]).toContain('notion');
    expect([...hostTokensFromUrl('https://docs.google.com/document/d/abc')]).not.toContain('google');
  });
});

describe('rootDomainFromHost', () => {
  it('normalizes Google subdomains to google.com', () => {
    expect(rootDomainFromHost('drive.google.com')).toBe('google.com');
    expect(rootDomainFromHost('mail.google.com')).toBe('google.com');
    expect(rootDomainFromHost('notebooklm.google.com')).toBe('google.com');
  });

  it('normalizes Outlook subdomain to live.com', () => {
    expect(rootDomainFromHost('outlook.live.com')).toBe('live.com');
  });

  it('handles standard 2-level public suffixes', () => {
    expect(rootDomainFromHost('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(rootDomainFromHost('juejin.cn')).toBe('juejin.cn');
    expect(rootDomainFromHost('sub.domain.com.cn')).toBe('domain.com.cn');
    expect(rootDomainFromHost('my-site.github.io')).toBe('my-site.github.io');
    expect(rootDomainFromHost('sub.my-site.github.io')).toBe('my-site.github.io');
    expect(rootDomainFromHost('app.vercel.app')).toBe('app.vercel.app');
  });

  it('preserves hosts with <= 2 parts and local addresses', () => {
    expect(rootDomainFromHost('excalidraw.com')).toBe('excalidraw.com');
    expect(rootDomainFromHost('localhost')).toBe('localhost');
    expect(rootDomainFromHost('127.0.0.1')).toBe('127.0.0.1');
    expect(rootDomainFromHost('co.uk')).toBe('co.uk');
    expect(rootDomainFromHost('www.google.com')).toBe('google.com');
  });
});
