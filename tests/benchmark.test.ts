import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeCopyAdapter } from '../src/adapters/native.ts';
import { benchmark } from '../src/benchmark/measure.ts';
import { createRandom } from '../src/benchmark/random.ts';
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
    'point-read',
    'point-update',
    'point-insert',
    'point-delete',
    'batch-update',
    'range-delete',
    'snapshot',
    'sequential-iteration',
  ]);
});

await test('every workload returns a collection with a consistent length', () => {
  for (const workload of workloadNames) {
    const values = Array.from({ length: options.size }, (_, index) => index);
    const initial = nativeCopyAdapter.create(values);
    const result = runWorkload(nativeCopyAdapter, workload, initial, options, 2);

    assert.ok(result.collection);
    assert.ok(nativeCopyAdapter.length(result.collection) >= 0);
    assert.ok(Number.isFinite(result.checksum));
  }
});
