import { describe, expect, it } from 'vitest';
import { canUseBookmarksApi } from './optional-api';

describe('canUseBookmarksApi', () => {
  it('is false when the optional bookmarks API is missing', () => {
    expect(canUseBookmarksApi(undefined)).toBe(false);
    expect(canUseBookmarksApi({})).toBe(false);
    expect(canUseBookmarksApi({ onCreated: { addListener() {} } })).toBe(true);
  });
});
