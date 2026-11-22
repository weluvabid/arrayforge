import assert from 'node:assert/strict';
import test from 'node:test';
import { adapterLabel, denseRanks, rankedResults } from '../benchmarks/browser/ranking.ts';
import type { BenchmarkResult } from '../src/benchmark/types.ts';

function registerTest(name: string, fn: () => void): void {
  test(name, fn).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function result(adapter: string, p50: number, p95 = p50, p99 = p95): BenchmarkResult {
  return {
    status: 'completed',
    adapter,
    workload: 'point-update',
    size: 100_000,
    rounds: 5,
    iterations: 10,
    targetSampleMs: 0,
    sampleDurationMs: p50 * 10,
    explicitGc: false,
    latencyMs: { p50, p95, p99 },
    operationsPerSecond: 1_000 / p50,
    memoryDeltaBytes: { heapUsed: null, external: null, arrayBuffers: null, rss: null },
    checksum: 0,
    structure: null,
  };
}

registerTest('ranks by measured p50, then p95, then p99', () => {
  const ranked = rankedResults([
    result('native-copy', 1, 1.4, 1.9),
    result('bplus-512', 1, 1.2, 1.8),
    result('rrb-512', 1, 1.2, 1.7),
    result('immer', 0.9, 1.8, 2.2),
  ]);
  assert.deepEqual(
    ranked.map((item) => item.adapter),
    ['immer', 'rrb-512', 'bplus-512', 'native-copy'],
  );
});

registerTest('uses raw measurements to order values that round to the same display value', () => {
  const ranked = rankedResults([
    result('native-copy', 1.2344, 1.5, 1.8),
    result('bplus-512', 1.23441, 1.5, 1.8),
    result('rrb-512', 1.23449, 1.5, 1.8),
  ]);
  assert.deepEqual(
    ranked.map((item) => item.adapter),
    ['native-copy', 'bplus-512', 'rrb-512'],
  );
});

registerTest('uses dense ranks for exact ties across all three percentiles', () => {
  const results = [
    result('bplus-1024', 1, 1.2, 1.4),
    result('rrb-1024', 1, 1.2, 1.4),
    result('rrb-512', 1.1, 1.3, 1.5),
    result('bplus-512', 1.2, 1.4, 1.6),
  ];
  const ranks = denseRanks(results);
  assert.equal(ranks.get('bplus-1024'), 1);
  assert.equal(ranks.get('rrb-1024'), 1);
  assert.equal(ranks.get('rrb-512'), 2);
  assert.equal(ranks.get('bplus-512'), 3);
});

registerTest('does not treat equal p50 as a tie when p95 or p99 differs', () => {
  const ranks = denseRanks([
    result('bplus-512', 1.23441, 1.5, 1.8),
    result('native-copy', 1.2344, 1.6, 1.8),
  ]);
  assert.equal(ranks.get('native-copy'), 1);
  assert.equal(ranks.get('bplus-512'), 2);
});

registerTest('uses ArrayForge display names for each tree configuration', () => {
  assert.equal(adapterLabel('bplus-1024'), 'ArrayForge B+ 1024');
  assert.equal(adapterLabel('rrb-1024'), 'ArrayForge RRB 1024');
});

registerTest(
  'treats values below displayed precision as ties and applies ArrayForge precedence',
  () => {
    const results = [
      result('immer', 0.0008, 0.0007, 0.0006),
      result('bplus-512', 0.0009, 0.0008, 0.0007),
      result('rrb-512', 0.0007, 0.0009, 0.0008),
      result('native-copy', 0.0006, 0.0006, 0.0009),
    ];

    assert.deepEqual(
      rankedResults(results).map((item) => item.adapter),
      ['rrb-512', 'bplus-512', 'immer', 'native-copy'],
    );
    const ranks = denseRanks(results);
    assert.deepEqual([...ranks.values()], [1, 1, 1, 1]);
  },
);

registerTest(
  'compares the next percentile when both values in the preceding percentile are below display precision',
  () => {
    const results = [
      result('immer', 0.0008, 0.002, 0.003),
      result('bplus-512', 0.0009, 0.001, 0.003),
    ];
    assert.deepEqual(
      rankedResults(results).map((item) => item.adapter),
      ['bplus-512', 'immer'],
    );
    const ranks = denseRanks(results);
    assert.equal(ranks.get('bplus-512'), 1);
    assert.equal(ranks.get('immer'), 2);
  },
);
