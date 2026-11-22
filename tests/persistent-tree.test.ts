import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BPlusVector,
  RrbVector,
  PAGE_SIZE,
  PROFILE,
  RRBVector,
  TREE,
  Vector,
  selectPageCapacity,
  type PersistentTreeVector,
} from '../src/persistent/tree.ts';
import type {
  BPlusVector as BPlusVectorType,
  RRBVector as RRBVectorType,
} from '../src/persistent/tree.ts';
import { createRandom } from '../src/benchmark/random.ts';
import { loadAdapters } from '../src/benchmark/adapters.ts';

type VectorFactory = (values: readonly number[], pageSize: number) => PersistentTreeVector<number>;

const factories: readonly [string, VectorFactory][] = [
  ['B+ tree', (values, pageSize) => BPlusVector.from(values, { pageSize })],
  ['RRB tree', (values, pageSize) => RrbVector.from(values, { pageSize })],
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
      actual.assertValid();
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
      pageSize: 32,
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
  assert.equal(selectPageCapacity(1_000_000), 256);
  assert.equal(selectPageCapacity(1_000_000, PROFILE.MUTATION_HEAVY), PAGE_SIZE.SMALL);
  assert.equal(selectPageCapacity(1_000_000, PROFILE.BATCH_HEAVY), PAGE_SIZE.SMALL);
  assert.equal(selectPageCapacity(999_999, PROFILE.READ_HEAVY), PAGE_SIZE.MEDIUM);
  assert.equal(selectPageCapacity(1_000_000, PROFILE.READ_HEAVY), PAGE_SIZE.LARGE);
  assert.equal(Vector.from([1, 2, 3]).kind, 'rrb');
  assert.equal(Vector.from([1, 2, 3]).pageSize, PAGE_SIZE.SMALL);
  assert.equal(Vector.from([1, 2, 3], { profile: PROFILE.BATCH_HEAVY }).kind, 'rrb');
  assert.equal(Vector.from([1, 2, 3], { profile: PROFILE.READ_HEAVY }).kind, 'rrb');
  assert.equal(Vector.from([1, 2, 3], { profile: PROFILE.MUTATION_HEAVY }).kind, 'bplus');
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
  await test(`${name} forEach visits every value once with its absolute index`, () => {
    const vector = createVector(
      Array.from({ length: 2_501 }, (_, index) => index * 3),
      64,
    );
    const visited: number[] = [];
    let indexSum = 0;

    vector.forEach((value, index) => {
      visited.push(value);
      indexSum += index;
    });

    assert.deepEqual(visited, vector.toArray());
    assert.equal(indexSum, (vector.length * (vector.length - 1)) / 2);
  });

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

for (const [name, createVector] of factories) {
  await test(`${name} batches transaction writes and preserves the source snapshot`, () => {
    const original = createVector(
      Array.from({ length: 2_000 }, (_, index) => index),
      32,
    );
    const committed = original.transact((draft) => {
      draft.set(1, -1);
      draft.set(2, -2);
      draft.set(33, -33);
      draft.set(1_999, -1_999);
      draft.insert(10, 10_000);
      draft.set(10, 10_001);
      draft.delete(20);
    });

    assert.equal(original.get(1), 1);
    assert.equal(original.get(33), 33);
    assert.equal(committed.get(1), -1);
    assert.equal(committed.get(2), -2);
    assert.equal(committed.get(10), 10_001);
    assert.equal(committed.length, 2_000);
  });

  await test(`${name} setMany accepts a pre-deduplicated Map`, () => {
    const original = createVector([0, 1, 2, 3, 4], 8);
    const updated = original.setMany(
      new Map<number, number>([
        [1, 10],
        [3, 30],
      ]),
    );

    assert.deepEqual([...original], [0, 1, 2, 3, 4]);
    assert.deepEqual([...updated], [0, 10, 2, 30, 4]);
    updated.assertValid();
  });

  await test(`${name} setMany reuses unchanged versions and validates structure`, () => {
    const original = createVector(
      Array.from({ length: 1_000 }, (_, index) => index),
      32,
    );
    const unchanged = original.setMany([
      { index: 10, value: 10 },
      { index: 20, value: 20 },
    ]);
    const updated = original.setMany([
      { index: 10, value: -10 },
      { index: 20, value: -20 },
      { index: 21, value: -21 },
      { index: 900, value: -900 },
    ]);

    assert.equal(unchanged, original);
    assert.equal(updated.get(10), -10);
    assert.equal(updated.get(20), -20);
    assert.equal(updated.get(21), -21);
    assert.equal(updated.get(900), -900);
    assert.equal(original.get(10), 10);
    updated.assertValid();
  });

  await test(`${name} rolls back failed callback transactions`, () => {
    const original = createVector([1, 2, 3, 4], 4);

    assert.throws(
      () =>
        original.transact((draft) => {
          draft.set(0, 99);
          throw new Error('abort');
        }),
      /abort/,
    );
    assert.deepEqual(original.toArray(), [1, 2, 3, 4]);
  });

  await test(`${name} rejects asynchronous transactions`, async () => {
    const original = createVector([1, 2, 3], 4);

    assert.throws(
      () =>
        original.transact(async (draft) => {
          await Promise.resolve();
          draft.set(0, 99);
        }),
      /must be synchronous/,
    );
    await Promise.resolve();
    assert.deepEqual(original.toArray(), [1, 2, 3]);
  });
}

for (const [name, factory] of [
  [
    'B+ tree',
    (values: readonly number[]) => BPlusVector.from(values, { pageSize: 8, branchFactor: 4 }),
  ],
  [
    'RRB tree',
    (values: readonly number[]) => RrbVector.from(values, { pageSize: 8, branchFactor: 4 }),
  ],
] as const) {
  await test(`${name} maintains multi-level invariants under sustained edits`, () => {
    const expected = Array.from({ length: 10_000 }, (_, index) => index);
    let actual = factory(expected);

    for (let operation = 0; operation < 1_500; operation += 1) {
      const index = (operation * 7_919) % expected.length;

      if (operation % 3 === 0) {
        actual = actual.delete(index);
        expected.splice(index, 1);
      } else if (operation % 3 === 1) {
        actual = actual.insert(index, -operation);
        expected.splice(index, 0, -operation);
      } else {
        actual = actual.set(index, -operation);
        expected[index] = -operation;
      }

      actual.assertValid();
      assert.equal(actual.length, expected.length);
    }

    assert.deepEqual(actual.toArray(), expected);
  });
}

for (const [name, createVector] of factories) {
  await test(`${name} slices retain structural invariants across page boundaries`, () => {
    for (const length of [0, 1, 7, 8, 9, 15, 16, 17, 63, 64, 65, 257, 1_003, 10_001]) {
      const values = Array.from({ length }, (_, index) => index);
      const original = createVector(values, 8);
      const ranges = [
        [0, length],
        [0, Math.floor(length / 2)],
        [Math.floor(length / 2), length],
        [1, Math.max(1, length - 1)],
        [Math.floor(length / 4), Math.floor((length * 3) / 4)],
        [length, length],
      ] as const;

      for (const [start, end] of ranges) {
        const sliced = original.slice(start, end);

        assert.deepEqual(sliced.toArray(), values.slice(start, end));
        sliced.assertValid();
      }
    }
  });

  await test(`${name} supports immutable slice, splice and concat`, () => {
    const original = createVector([0, 1, 2, 3, 4, 5], 4);
    const sliced = original.slice(1, -1);
    const spliced = original.splice(2, 2, 20, 30);
    const concatenated = original.concat([6, 7]);
    const generated = original.concat(
      (function* () {
        yield 6;
        yield 7;
      })(),
    );

    assert.deepEqual(sliced.toArray(), [1, 2, 3, 4]);
    assert.deepEqual(spliced.toArray(), [0, 1, 20, 30, 4, 5]);
    assert.deepEqual(concatenated.toArray(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(generated.toArray(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(original.slice(), original);
    assert.deepEqual(original.toArray(), [0, 1, 2, 3, 4, 5]);
    sliced.assertValid();
    spliced.assertValid();
    concatenated.assertValid();
  });

  await test(`${name} converts between tree structures without changing values`, () => {
    const original = createVector(
      Array.from({ length: 2_500 }, (_, index) => index),
      32,
    );
    const converted = original.convertTo(original.kind === 'bplus' ? TREE.RRB : TREE.B_PLUS);
    const dedicated = original.kind === 'bplus' ? original.toRRB() : original.toBPlus();

    assert.equal(converted.kind, original.kind === 'bplus' ? 'rrb' : 'bplus');
    assert.deepEqual(converted.toArray(), original.toArray());
    assert.deepEqual(dedicated.toArray(), original.toArray());
    assert.equal(original.length, 2_500);
    converted.assertValid();
    dedicated.assertValid();
  });
}

await test('RRB structural joins handle different tree heights and preserve inputs', () => {
  const lengths = [0, 1, 7, 8, 9, 31, 32, 33, 257, 1_025, 10_001];

  for (const leftLength of lengths) {
    for (const rightLength of lengths) {
      const leftValues = Array.from({ length: leftLength }, (_, index) => index);
      const rightValues = Array.from({ length: rightLength }, (_, index) => leftLength + index);
      const left = RRBVector.from(leftValues, { pageSize: 8, branchFactor: 4 });
      const right = RRBVector.from(rightValues, { pageSize: 8, branchFactor: 4 });
      const joined = left.concat(right);

      assert.deepEqual(joined.toArray(), [...leftValues, ...rightValues]);
      joined.assertValid();
      left.assertValid();
      right.assertValid();
    }
  }
});

await test('RRB splice composes structural slices and joins', () => {
  const values = Array.from({ length: 10_001 }, (_, index) => index);
  const original = RRBVector.from(values, { pageSize: 8, branchFactor: 4 });
  const expected = values.slice();
  expected.splice(1_237, 4_321, -1, -2, -3, -4);
  const spliced = original.splice(1_237, 4_321, -1, -2, -3, -4);

  assert.deepEqual(spliced.toArray(), expected);
  spliced.assertValid();
  assert.deepEqual(original.toArray(), values);
  original.assertValid();
});

await test('Vector factory honours explicit tree selection and workload profiles', () => {
  assert.equal(Object.isFrozen(PROFILE), true);
  assert.equal(Object.isFrozen(TREE), true);
  assert.equal(Object.isFrozen(PAGE_SIZE), true);
  assert.equal(Vector.from([1, 2], { tree: TREE.B_PLUS }).kind, 'bplus');
  assert.equal(Vector.from([1, 2], { tree: TREE.RRB }).kind, 'rrb');
  assert.equal(Vector.from([1, 2], { tree: TREE.AUTO, profile: PROFILE.BATCH_HEAVY }).kind, 'rrb');
  assert.equal(
    Vector.from([1, 2], { tree: TREE.AUTO, profile: PROFILE.MUTATION_HEAVY }).kind,
    'bplus',
  );
  assert.equal(Vector.from([1, 2], { tree: TREE.RRB, profile: PROFILE.BALANCED }).kind, 'rrb');
  assert.equal(
    Vector.from([1, 2], { tree: TREE.B_PLUS, profile: PROFILE.BATCH_HEAVY }).kind,
    'bplus',
  );
  assert.equal(RRBVector.from([1, 2]).kind, 'rrb');
  assert.throws(() => Vector.from([1], { profile: 'unknown' as never }), TypeError);
  assert.throws(() => Vector.from([1], { tree: 'unknown' as never }), TypeError);
  assert.throws(() => BPlusVector.from([1]).convertTo('auto' as never), TypeError);
});

await test('profile changes rebuild for the requested workload and preserve the source', () => {
  const original = Vector.from([1, 2, 3, 4]);
  const batch = original.withProfile(PROFILE.BATCH_HEAVY);
  const read = batch.withProfile(PROFILE.READ_HEAVY);
  const mutation = read.withProfile(PROFILE.MUTATION_HEAVY);

  assert.equal(original.kind, 'rrb');
  assert.equal(batch.kind, 'rrb');
  assert.equal(read.kind, 'rrb');
  assert.equal(mutation.kind, 'bplus');
  assert.deepEqual(batch.toArray(), original.toArray());
  assert.deepEqual(read.toArray(), original.toArray());
  assert.deepEqual(mutation.toArray(), original.toArray());
});

await test('persistent tree adapters apply batch writes through the collection API', async () => {
  const loaded = await loadAdapters(['bplus-256', 'rrb-256']);
  const values = Array.from({ length: 100 }, (_, index) => index);

  for (const result of loaded) {
    const adapter = result.adapter;

    assert.ok(adapter);

    const original = adapter.create(values);
    const updated = adapter.updateMany(original, [
      { index: 10, value: -10 },
      { index: 20, value: -20 },
      { index: 90, value: -90 },
    ]);

    assert.equal(adapter.get(updated, 10), -10);
    assert.equal(adapter.get(updated, 20), -20);
    assert.equal(adapter.get(updated, 90), -90);
    assert.equal(adapter.get(original, 10), 10);
  }
});

await test('B+ iterable construction balances an underfull final page', () => {
  for (const length of [1, 7, 8, 9, 15, 16, 17, 23, 24, 25, 65]) {
    const values = Array.from({ length }, (_, index) => index);
    const source = RRBVector.from(values, { pageSize: 8, branchFactor: 4 });
    const converted = source.toBPlus({ pageSize: 8, branchFactor: 4 });

    assert.deepEqual(converted.toArray(), values);
    converted.assertValid();
  }
});

await test('dedicated constructors and conversion methods retain concrete tree types', () => {
  const bplus: BPlusVectorType<number> = BPlusVector.from([1, 2, 3]);
  const rrb: RRBVectorType<number> = bplus.toRRB();
  const convertedByFactory: RRBVectorType<number> = bplus.convertTo(TREE.RRB);
  const convertedBack: BPlusVectorType<number> = rrb.toBPlus();

  assert.equal(bplus.kind, TREE.B_PLUS);
  assert.equal(rrb.kind, TREE.RRB);
  assert.equal(convertedByFactory.kind, TREE.RRB);
  assert.equal(convertedBack.kind, TREE.B_PLUS);
});

for (const [name, create] of [
  ['B+ tree', (values: number[]) => BPlusVector.from(values, { pageSize: 64 })],
  ['RRB tree', (values: number[]) => RrbVector.from(values, { pageSize: 64 })],
] as const) {
  await test(`${name} maintains healthy occupancy through random mutation churn`, () => {
    const values = Array.from({ length: 20_000 }, (_, index) => index);
    const original = create(values);
    let vector = original;
    let state = 0x9e3779b9;

    for (let iteration = 0; iteration < 5_000; iteration += 1) {
      state = (Math.imul(state ^ (state >>> 16), 0x21f0aaad) + 0x735a2d97) >>> 0;
      const deleteIndex = state % vector.length;
      vector = vector.delete(deleteIndex);
      state = (Math.imul(state ^ (state >>> 15), 0x735a2d97) + 0x9e3779b9) >>> 0;
      const insertIndex = state % (vector.length + 1);
      vector = vector.insert(insertIndex, 20_000 + iteration);
    }

    vector.assertValid();
    assert.equal(vector.length, values.length);
    assert.equal(original.get(0), 0);
    const stats = (
      vector as typeof vector & {
        inspectStructure(): { minLeafOccupancy: number; maxLeafOccupancy: number };
      }
    ).inspectStructure();
    assert.ok(stats.minLeafOccupancy >= 32);
    assert.ok(stats.maxLeafOccupancy <= 64);
  });
}
