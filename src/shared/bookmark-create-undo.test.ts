import { describe, expect, test, vi } from 'vitest';
import {
  restoreCreatedBookmarkIds,
  shouldIgnoreBookmarkCreated,
  withBookmarkCreatedFilingSuppressed,
} from './bookmark-create-undo';

describe('shouldIgnoreBookmarkCreated', () => {
  test('ignores listeners only while suppress is held', () => {
    expect(shouldIgnoreBookmarkCreated(0)).toBe(false);
    expect(shouldIgnoreBookmarkCreated(2)).toBe(true);
  });
});

describe('withBookmarkCreatedFilingSuppressed', () => {
  test('holds suppress across persist and decrements after', async () => {
    let suppress = 0;
    const seen: number[] = [];
    await withBookmarkCreatedFilingSuppressed(2, (delta) => { suppress += delta; }, async () => {
      expect(suppress).toBe(2);
      await Promise.resolve();
      seen.push(suppress);
    });
    expect(seen).toEqual([2]);
    expect(suppress).toBe(0);
  });

  test('decrements after a persist-then-rethrow path', async () => {
    let suppress = 0;
    await expect(withBookmarkCreatedFilingSuppressed(1, (delta) => { suppress += delta; }, async () => {
      expect(suppress).toBe(1);
      throw new Error('create failed');
    })).rejects.toThrow('create failed');
    expect(suppress).toBe(0);
  });
});

describe('restoreCreatedBookmarkIds', () => {
  test('treats a missing node as already undone', async () => {
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    await restoreCreatedBookmarkIds([{ id: 'gone' }, { id: 'keep' }], {
      get: async (id) => {
        if (id === 'gone') throw new Error('missing');
        return [{ id }];
      },
      remove: vi.fn().mockResolvedValue(undefined),
      checkpoint,
    });
    expect(checkpoint).toHaveBeenCalledWith([{ id: 'keep' }]);
    expect(checkpoint).toHaveBeenLastCalledWith([]);
  });

  test('checkpoints the failed id and rethrows when remove fails', async () => {
    const checkpoint = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockRejectedValue(new Error('permission'));
    await expect(restoreCreatedBookmarkIds([{ id: 'a' }, { id: 'b' }], {
      get: async (id) => [{ id }],
      remove,
      checkpoint,
    })).rejects.toThrow('permission');
    expect(checkpoint).toHaveBeenLastCalledWith([{ id: 'a' }, { id: 'b' }]);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
