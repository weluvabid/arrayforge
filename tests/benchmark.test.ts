import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCopyAdapter, nativeMutableAdapter } from '../src/adapters/native.ts';
import { benchmark } from '../src/benchmark/measure.ts';
import { printTable, toCsv } from '../src/benchmark/report.ts';
import { createChanges, createRandom } from '../src/benchmark/random.ts';
import { runWorkload, workloadNames } from '../src/benchmark/workloads.ts';
import type { BenchmarkOptions } from '../src/benchmark/types.ts';

const options: BenchmarkOptions = {
  size: 1_000,
  rounds: 3,
  warmup: 1,
  seed: 42,
};

await test('benchmark runner returns stable result metadata', () => {
  const result = benchmark(nativeCopyAdapter, 'point-update', options, 5);

  assert.equal(result.adapter, 'native-copy');
  assert.equal(result.workload, 'point-update');
  assert.equal(result.size, 1_000);
  assert.equal(result.rounds, 3);
  assert.equal(result.iterations, 5);
  assert.equal(result.targetSampleMs, 25);
  assert.ok(result.sampleDurationMs >= 0);
  assert.equal(typeof result.explicitGc, 'boolean');
  assert.ok(result.latencyMs.p50 >= 0);
  assert.ok(result.operationsPerSecond > 0);
  assert.ok('heapUsed' in result.memoryDeltaBytes);
  assert.ok('arrayBuffers' in result.memoryDeltaBytes);
});

await test('random generator produces repeatable sequences', () => {
  const first = createRandom(123);
  const second = createRandom(123);

  assert.deepEqual(
    Array.from({ length: 20 }, () => first()),
    Array.from({ length: 20 }, () => second()),
  );
});

await test('workload registry contains the supported operations', () => {
  assert.deepEqual(workloadNames, [
    'construction',
    'point-read',
    'point-update',
    'point-insert',
    'point-delete',
    'batch-update',
    'range-delete',
    'snapshot',
    'sequential-iteration',
    'sequential-visit',
    'mixed-operations',
    'mutation-churn',
  ]);
});

await test('every workload returns a collection with a consistent length', () => {
  for (const workload of workloadNames) {
    const values = Array.from({ length: options.size }, (_, index) => index);
    const initial = nativeCopyAdapter.create(values);
    const result = runWorkload(
      {
        ...nativeCopyAdapter,
        forEach: (collection, callback) => (collection as number[]).forEach(callback),
      },
      workload,
      initial,
      options,
      2,
    );

    assert.ok(result.collection);
    assert.ok(nativeCopyAdapter.length(result.collection) >= 0);
    assert.ok(Number.isFinite(result.checksum));
  }
});

await test('construction workload measures adapter creation', () => {
  let creations = 0;
  const adapter = {
    ...nativeCopyAdapter,
    name: 'counting-copy',
    create: (values: number[]) => {
      creations += 1;
      return values.slice();
    },
  };
  const result = benchmark(adapter, 'construction', options, 1);

  assert.ok(creations >= options.warmup + options.rounds);
  assert.equal(result.workload, 'construction');
  assert.equal(result.iterations, 1);
  assert.equal(result.checksum, options.size * options.rounds);
});

await test('delete workloads cap requested iterations to available data', () => {
  const pointDelete = benchmark(nativeCopyAdapter, 'point-delete', options, 5_000);
  const rangeDelete = benchmark(nativeCopyAdapter, 'range-delete', options, 5_000);

  assert.equal(pointDelete.iterations, options.size);
  assert.equal(rangeDelete.iterations, 75);
});

await test('mutable and copy adapters apply point and range deletes sequentially', () => {
  const values = Array.from({ length: options.size }, (_, index) => index);

  for (const workload of ['point-delete', 'range-delete'] as const) {
    const copyResult = runWorkload(
      nativeCopyAdapter,
      workload,
      nativeCopyAdapter.create(values),
      options,
      8,
    );
    const mutableResult = runWorkload(
      nativeMutableAdapter,
      workload,
      nativeMutableAdapter.create(values),
      options,
      8,
    );

    assert.deepEqual(copyResult.collection, mutableResult.collection);
    assert.equal(copyResult.checksum, mutableResult.checksum);
  }
});

await test('benchmark calibrates short workloads to the target sample duration', () => {
  const result = benchmark(nativeCopyAdapter, 'point-read', { ...options, targetSampleMs: 5 });

  assert.ok(result.iterations >= 1_000);
  assert.ok(result.sampleDurationMs > 0);
});

await test('benchmark reports include calibration and memory collection metadata', () => {
  const result = benchmark(nativeCopyAdapter, 'point-read', options, 5);
  const table = printTable([result]);
  const csv = toCsv([result]);

  assert.match(table, /iterations/);
  assert.match(table, /explicit gc/);
  assert.match(csv, /target_sample_ms/);
  assert.match(csv, /explicit_gc/);
  assert.match(csv, /,(?:true|false),/);
});

await test('mixed workload produces the same deterministic result across native adapters', () => {
  const values = Array.from({ length: options.size }, (_, index) => index);
  const copyResult = runWorkload(
    nativeCopyAdapter,
    'mixed-operations',
    nativeCopyAdapter.create(values),
    options,
    500,
  );

  const mutableResult = runWorkload(
    nativeMutableAdapter,
    'mixed-operations',
    nativeMutableAdapter.create(values),
    options,
    500,
  );

  assert.deepEqual(copyResult.collection, mutableResult.collection);
  assert.equal(copyResult.checksum, mutableResult.checksum);
});

await test('batch updates alternate values so every measured pass changes the collection', () => {
  const values = Array.from({ length: options.size }, (_, index) => index);
  const changes = createChanges(options.size, Math.min(1_000, options.size), options.seed);
  const result = runWorkload(
    nativeCopyAdapter,
    'batch-update',
    nativeCopyAdapter.create(values),
    options,
    2,
  );
  const finalValues = result.collection as number[];

  const expected = new Map(changes.map((change) => [change.index, change.value]));

  for (const [index, value] of expected) {
    assert.equal(finalValues[index], options.size + value);
  }
});

await test('mutation churn preserves length and is deterministic across native adapters', () => {
  const values = Array.from({ length: options.size }, (_, index) => index);
  const copyResult = runWorkload(
    nativeCopyAdapter,
    'mutation-churn',
    nativeCopyAdapter.create(values),
    options,
    100,
  );
  const mutableResult = runWorkload(
    nativeMutableAdapter,
    'mutation-churn',
    nativeMutableAdapter.create(values),
    options,
    100,
  );

  assert.equal(nativeCopyAdapter.length(copyResult.collection), options.size);
  assert.deepEqual(copyResult.collection, mutableResult.collection);
  assert.equal(copyResult.checksum, mutableResult.checksum);
});

await test('persistent tree churn reports post-workload structural health', async () => {
  const { BPlusVector, RrbVector } = await import('../src/persistent/tree.ts');

  for (const vector of [
    BPlusVector.from(
      Array.from({ length: 2_000 }, (_, index) => index),
      { pageSize: 64 },
    ),
    RrbVector.from(
      Array.from({ length: 2_000 }, (_, index) => index),
      { pageSize: 64 },
    ),
  ]) {
    const stats = (
      vector as typeof vector & {
        inspectStructure(): {
          nodes: number;
          leaves: number;
          height: number;
          minLeafOccupancy: number;
          meanLeafOccupancy: number;
          maxLeafOccupancy: number;
        };
      }
    ).inspectStructure();

    assert.ok(stats.nodes >= stats.leaves);
    assert.ok(stats.leaves > 0);
    assert.equal(stats.meanLeafOccupancy * stats.leaves, vector.length);
    assert.ok(stats.maxLeafOccupancy <= 64);
  }
});

await test('calibration excludes initial collection construction for non-construction workloads', () => {
  const adapter = {
    ...nativeCopyAdapter,
    name: 'slow-create-copy',
    create: (values: number[]) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 3) {
        // Simulate setup work that must remain outside the measured workload.
      }

      return values.slice();
    },
  };
  const result = benchmark(adapter, 'point-read', { ...options, targetSampleMs: 5 });

  assert.ok(result.iterations > 1_000);
});
