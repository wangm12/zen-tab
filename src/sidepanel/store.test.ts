import { beforeEach, describe, expect, it } from 'vitest';
import { showsUnifiedSearch, useZenTabStore } from './store';

describe('setSection', () => {
  beforeEach(() => {
    useZenTabStore.setState({
      section: 'tabs',
      search: 'research dump',
    });
  });

  it('clears search by default', () => {
    useZenTabStore.getState().setSection('stashes');
    expect(useZenTabStore.getState()).toEqual(expect.objectContaining({
      section: 'stashes',
      search: '',
    }));
  });

  it('preserves search when keepSearch is true', () => {
    useZenTabStore.getState().setSection('stashes', { keepSearch: true });
    expect(useZenTabStore.getState()).toEqual(expect.objectContaining({
      section: 'stashes',
      search: 'research dump',
    }));
  });
});

describe('showsUnifiedSearch', () => {
  it('keeps StashList visible after jump-stash with a live query', () => {
    expect(showsUnifiedSearch('tabs', 'research')).toBe(true);
    expect(showsUnifiedSearch('bookmarks', 'docs')).toBe(true);
    expect(showsUnifiedSearch('stashes', 'research')).toBe(false);
    expect(showsUnifiedSearch('stashes', '')).toBe(false);
    expect(showsUnifiedSearch('tabs', '  ')).toBe(false);
  });
});

describe('bookmark store events', () => {
  beforeEach(() => {
    useZenTabStore.setState({
      bookmarkEpoch: 0,
      bookmarkFilingSuggestion: null,
    });
  });

  it('invalidates the component-local bookmark tree', () => {
    useZenTabStore.getState().applyEvent({ type: 'BOOKMARKS_UPDATED' });
    expect(useZenTabStore.getState().bookmarkEpoch).toBe(1);
  });

  it('retains filing suggestions for BookmarkList to preview', () => {
    const event = {
      type: 'BOOKMARK_FILING_SUGGESTED' as const,
      bookmarkId: 'bookmark-1',
      title: 'Example',
      url: 'https://example.com',
      suggestion: null,
    };
    useZenTabStore.getState().applyEvent(event);
    expect(useZenTabStore.getState().bookmarkFilingSuggestion).toEqual(event);
  });
});
