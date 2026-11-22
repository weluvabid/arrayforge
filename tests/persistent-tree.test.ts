import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BPlusVector,
  RrbVector,
  Vector,
  selectPageCapacity,
  type PersistentTreeVector,
} from '../src/persistent/tree.ts';
import { createRandom } from '../src/benchmark/random.ts';
import { loadAdapters } from '../src/benchmark/adapters.ts';

type VectorFactory = (
  values: readonly number[],
  pageCapacity: number,
) => PersistentTreeVector<number>;

const factories: readonly [string, VectorFactory][] = [
  ['B+ tree', (values, pageCapacity) => BPlusVector.from(values, { pageCapacity })],
  ['RRB tree', (values, pageCapacity) => RrbVector.from(values, { pageCapacity })],
];

for (const [name, createVector] of factories) {
  await test(`${name} builds indexed pages and iterates in order`, () => {
    const values = Array.from({ length: 2_500 }, (_, index) => index);
    const vector = createVector(values, 64);

    assert.equal(vector.length, values.length);
    assert.equal(vector.get(0), 0);
    assert.equal(vector.get(63), 63);
    assert.equal(vector.get(64), 64);
    assert.equal(vector.get(1_234), 1_234);
    assert.equal(vector.get(2_499), 2_499);
    assert.deepEqual(vector.toArray(), values);
  });

  await test(`${name} preserves snapshots and shares no-op updates`, () => {
    const original = createVector([1, 2, 3, 4, 5], 4);
    const snapshot = original.snapshot();
    const updated = original.set(2, 30);
    const unchanged = original.set(2, 3);

    assert.equal(snapshot, original);
    assert.equal(unchanged, original);
    assert.deepEqual(original.toArray(), [1, 2, 3, 4, 5]);
    assert.deepEqual(updated.toArray(), [1, 2, 30, 4, 5]);
  });

  await test(`${name} matches native arrays through randomized edits`, () => {
    const random = createRandom(7123);
    const expected = Array.from({ length: 250 }, (_, index) => index);
    let actual = createVector(expected, 16);

    for (let operation = 0; operation < 1_500; operation += 1) {
      const choice = Math.floor(random() * 4);
      const index = Math.floor(random() * (expected.length + (choice === 1 ? 1 : 0)));
      const value = 20_000 + operation;

      if (choice === 0 && expected.length > 0) {
        actual = actual.set(index % expected.length, value);
        expected[index % expected.length] = value;
      } else if (choice === 1) {
        actual = actual.insert(index, value);
        expected.splice(index, 0, value);
      } else if (choice === 2 && expected.length > 0) {
        const deleteIndex = index % expected.length;
        actual = actual.delete(deleteIndex);
        expected.splice(deleteIndex, 1);
      } else if (expected.length > 1) {
        const start = index % expected.length;
        const end = Math.min(expected.length, start + 1 + Math.floor(random() * 8));
        actual = actual.deleteRange(start, end);
        expected.splice(start, end - start);
      }

      assert.equal(actual.length, expected.length);
      assert.deepEqual(actual.toArray(), expected);
    }
  });

  await test(`${name} handles empty collections and boundary edits`, () => {
    const empty = createVector([], 8);
    const one = empty.insert(0, 42);
    const removed = one.delete(0);

    assert.deepEqual(empty.toArray(), []);
    assert.deepEqual(one.toArray(), [42]);
    assert.deepEqual(removed.toArray(), []);
    assert.equal(empty.deleteRange(0, 0), empty);
  });

  await test(`${name} rejects invalid indexes and ranges`, () => {
    const vector = createVector([1, 2, 3], 8);

    assert.throws(() => vector.get(-1), RangeError);
    assert.throws(() => vector.get(3), RangeError);
    assert.throws(() => vector.set(3, 4), RangeError);
    assert.throws(() => vector.insert(4, 4), RangeError);
    assert.throws(() => vector.deleteRange(2, 4), RangeError);
    assert.throws(() => vector.deleteRange(2, 1), RangeError);
  });
}

await test('tree candidates retain earlier versions after repeated edits', () => {
  const first = BPlusVector.from(
    Array.from({ length: 1_000 }, (_, index) => index),
    {
      pageCapacity: 32,
    },
  );
  const second = first.set(400, -1);
  const third = second.insert(500, -2);
  const fourth = third.deleteRange(100, 300);

  assert.equal(first.get(400), 400);
  assert.equal(second.get(400), -1);
  assert.equal(third.get(500), -2);
  assert.equal(fourth.length, 801);
});

await test('adaptive page capacity follows the selected workload profile', () => {
  assert.equal(selectPageCapacity(10_000), 256);
  assert.equal(selectPageCapacity(1_000_000), 512);
  assert.equal(selectPageCapacity(1_000_000, 'mutation-heavy'), 256);
  assert.equal(selectPageCapacity(1_000_000, 'read-heavy'), 1024);
  assert.equal(Vector.from([1, 2, 3]).kind, 'rrb');
  assert.equal(Vector.from([1, 2, 3]).pageCapacity, 256);
});

for (const [name, createVector] of factories) {
  await test(`${name} deletes large ranges across tree levels`, () => {
    const values = Array.from({ length: 10_000 }, (_, index) => index);
    const original = createVector(values, 8);
    const updated = original.deleteRange(123, 9_876);

    assert.equal(updated.length, 247);
    assert.deepEqual(updated.toArray(), [...values.slice(0, 123), ...values.slice(9_876)]);
    assert.equal(original.length, 10_000);
    assert.equal(original.get(9_999), 9_999);
  });
}

await test('benchmark registry exposes all tree and page-capacity candidates', async () => {
  const loaded = await loadAdapters([
    'bplus-256',
    'bplus-512',
    'bplus-1024',
    'rrb-256',
    'rrb-512',
    'rrb-1024',
  ]);

  assert.deepEqual(
    loaded.map((result) => result.adapter?.name),
    ['bplus-256', 'rrb-256', 'bplus-512', 'rrb-512', 'bplus-1024', 'rrb-1024'],
  );
});

for (const [name, createVector] of factories) {
  await test(`${name} iterators are independent and support early termination`, () => {
    const vector = createVector([10, 20, 30, 40, 50], 4);
    const first = vector[Symbol.iterator]();
    const second = vector[Symbol.iterator]();

    assert.deepEqual(first.next(), { done: false, value: 10 });
    assert.deepEqual(first.next(), { done: false, value: 20 });
    assert.deepEqual(second.next(), { done: false, value: 10 });
    assert.deepEqual([...second], [20, 30, 40, 50]);
    assert.deepEqual([...first], [30, 40, 50]);
    assert.deepEqual(first.next(), { done: true, value: undefined });
  });
}
