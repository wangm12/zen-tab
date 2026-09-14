import { expect, test } from 'vitest';
import { decideCreatedBookmarkAction, shouldSuppressCreatedBookmarkFiling } from './bookmark-created';

test('never auto-files', () => {
  expect(decideCreatedBookmarkAction({ isInbox: false })).toBe('ignore');
  expect(decideCreatedBookmarkAction({ isInbox: true })).toBe('suggest');
});

test('only suppresses filing suggestions when the user already chose a folder', () => {
  expect(shouldSuppressCreatedBookmarkFiling(undefined)).toBe(false);
  expect(shouldSuppressCreatedBookmarkFiling({ folderKind: 'other' })).toBe(false);
  expect(shouldSuppressCreatedBookmarkFiling({ folderKind: 'folder', isInbox: true })).toBe(false);
  expect(shouldSuppressCreatedBookmarkFiling({ folderKind: 'folder' })).toBe(true);
  expect(shouldSuppressCreatedBookmarkFiling({ folderKind: 'bar' })).toBe(true);
});
