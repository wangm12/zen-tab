import { describe, expect, it } from 'vitest';
import { DEFAULT_GROQ_BASE_URL, hostPermissionForBaseUrl, normalizeOpenAiBaseUrl } from './openai';

describe('openai-compatible endpoint helpers', () => {
  it('builds a host permission pattern from https and localhost http URLs', () => {
    expect(hostPermissionForBaseUrl('https://api.groq.com/openai/v1')).toBe('https://api.groq.com/*');
    expect(hostPermissionForBaseUrl('http://127.0.0.1:11434/v1')).toBe('http://127.0.0.1:11434/*');
    expect(hostPermissionForBaseUrl('not a url')).toBeNull();
    expect(hostPermissionForBaseUrl('ftp://example.com')).toBeNull();
  });

  it('normalizes a base URL and keeps the Groq default', () => {
    expect(normalizeOpenAiBaseUrl(' https://api.openai.com/v1/ ')).toBe('https://api.openai.com/v1');
    expect(normalizeOpenAiBaseUrl('')).toBe(DEFAULT_GROQ_BASE_URL);
    expect(normalizeOpenAiBaseUrl('nope')).toBe(DEFAULT_GROQ_BASE_URL);
  });
});
