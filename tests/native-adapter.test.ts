import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCopyAdapter, nativeMutableAdapter } from '../src/adapters/native.ts';
import { createRandom } from '../src/benchmark/random.ts';

for (const adapter of [nativeCopyAdapter, nativeMutableAdapter]) {
  await test(`${adapter.name} follows the collection adapter contract`, () => {
    let collection = adapter.create([1, 2, 3, 4]);
    collection = adapter.set(collection, 1, 20);
    assert.deepEqual([...adapter.iterate(collection)], [1, 20, 3, 4]);

    collection = adapter.updateMany(collection, [
      { index: 0, value: 10 },
      { index: 3, value: 40 },
    ]);
    assert.deepEqual([...adapter.iterate(collection)], [10, 20, 3, 40]);

    collection = adapter.insert(collection, 2, 30);
    assert.deepEqual([...adapter.iterate(collection)], [10, 20, 30, 3, 40]);

    collection = adapter.delete(collection, 0);
    assert.deepEqual([...adapter.iterate(collection)], [20, 30, 3, 40]);

    collection = adapter.deleteRange(collection, 1, 2);
    assert.deepEqual([...adapter.iterate(collection)], [20, 3, 40]);
    assert.equal(adapter.length(collection), 3);
  });
}

await test('native-copy preserves every earlier version', () => {
  const first = nativeCopyAdapter.create([10, 20, 30]);
  const second = nativeCopyAdapter.set(first, 1, 200);
  const third = nativeCopyAdapter.delete(second, 0);

  assert.deepEqual([...nativeCopyAdapter.iterate(first)], [10, 20, 30]);
  assert.deepEqual([...nativeCopyAdapter.iterate(second)], [10, 200, 30]);
  assert.deepEqual([...nativeCopyAdapter.iterate(third)], [200, 30]);
});

await test('native-copy matches native array operations across a deterministic sequence', () => {
  const random = createRandom(91);
  const expected = Array.from({ length: 100 }, (_, index) => index);
  let actual = nativeCopyAdapter.create(expected);

  for (let operation = 0; operation < 500; operation += 1) {
    const choice = Math.floor(random() * 4);
    const index = Math.floor(random() * Math.max(1, expected.length));
    const value = operation + 10_000;

    if (choice === 0) {
      actual = nativeCopyAdapter.set(actual, index, value);
      expected[index] = value;
    } else if (choice === 1) {
      actual = nativeCopyAdapter.insert(actual, index, value);
      expected.splice(index, 0, value);
    } else if (choice === 2 && expected.length > 0) {
      actual = nativeCopyAdapter.delete(actual, index);
      expected.splice(index, 1);
    } else if (expected.length > 1) {
      const end = Math.min(expected.length, index + 2);
      actual = nativeCopyAdapter.deleteRange(actual, index, end);
      expected.splice(index, end - index);
    }

    assert.deepEqual([...nativeCopyAdapter.iterate(actual)], expected);
  }
});

await test('native-mutable updates the supplied collection in place', () => {
  const original = nativeMutableAdapter.create([1, 2, 3]);
  const updated = nativeMutableAdapter.set(original, 1, 9);

  assert.equal(updated, original);
  assert.deepEqual([...nativeMutableAdapter.iterate(original)], [1, 9, 3]);
});
await test('native-copy handles empty collections and boundary edits', () => {
  const empty = nativeCopyAdapter.create([]);
  const appended = nativeCopyAdapter.insert(empty, 0, 7);
  const deleted = nativeCopyAdapter.delete(appended, 0);
  const unchanged = nativeCopyAdapter.deleteRange(empty, 0, 0);

  assert.deepEqual([...nativeCopyAdapter.iterate(empty)], []);
  assert.deepEqual([...nativeCopyAdapter.iterate(appended)], [7]);
  assert.deepEqual([...nativeCopyAdapter.iterate(deleted)], []);
  assert.deepEqual([...nativeCopyAdapter.iterate(unchanged)], []);
});
