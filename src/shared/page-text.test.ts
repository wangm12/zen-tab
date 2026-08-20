import { describe, expect, it } from 'vitest';
import { extractGroupingPageTextFrom } from './page-text';

describe('grouping page text', () => {
  it('prefers article or main content over the full document body', () => {
    const doc = {
      querySelector(selector: string) {
        if (selector.includes('article')) return { innerText: '  Hiring plan for Q3  ' };
        return null;
      },
      body: { innerText: 'Nav Cookie banner Hiring plan for Q3 Footer' },
    };
    expect(extractGroupingPageTextFrom(doc)).toBe('Hiring plan for Q3');
  });
});
