import { performance } from 'node:perf_hooks';
import { createValues } from './random.ts';
import { defaultIterations, runWorkload } from './workloads.ts';
import type {
  BenchmarkOptions,
  BenchmarkResult,
  CollectionAdapter,
  WorkloadName,
} from './types.ts';

interface RuntimeMemory {
  readonly heapUsed: number;
  readonly external: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

interface Sample {
  readonly latencyMs: number;
  readonly operationsPerSecond: number;
  readonly memoryDeltaBytes: {
    readonly heapUsed: number | null;
    readonly external: number | null;
    readonly arrayBuffers: number | null;
    readonly rss: number | null;
  };
  readonly checksum: number;
}

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );

  return sorted[index] ?? 0;
}

function collectMemory(): RuntimeMemory | null {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') {
    return null;
  }

  const memory = process.memoryUsage();

  return {
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
    rss: memory.rss,
  };
}

function collectGarbage(): void {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };

  runtime.gc?.();
}

function runSample(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  values: number[],
  options: BenchmarkOptions,
  iterations: number,
): Sample {
  collectGarbage();

  const memoryBefore = collectMemory();
  const collection = adapter.create(values);
  const startedAt = performance.now();
  const run = runWorkload(adapter, workload, collection, options, iterations);
  const elapsedMs = Math.max(performance.now() - startedAt, 0.000_001);
  collectGarbage();

  const memoryAfter = collectMemory();

  return {
    latencyMs: elapsedMs / iterations,
    operationsPerSecond: (iterations / elapsedMs) * 1_000,
    memoryDeltaBytes: {
      heapUsed:
        memoryBefore === null || memoryAfter === null
          ? null
          : memoryAfter.heapUsed - memoryBefore.heapUsed,
      external:
        memoryBefore === null || memoryAfter === null
          ? null
          : memoryAfter.external - memoryBefore.external,
      arrayBuffers:
        memoryBefore === null || memoryAfter === null
          ? null
          : memoryAfter.arrayBuffers - memoryBefore.arrayBuffers,
      rss:
        memoryBefore === null || memoryAfter === null ? null : memoryAfter.rss - memoryBefore.rss,
    },
    checksum: run.checksum + adapter.length(run.collection),
  };
}

export function benchmark(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  options: BenchmarkOptions,
  iterations = defaultIterations(workload, options.size),
): BenchmarkResult {
  const values = createValues(options.size);

  for (let warmup = 0; warmup < options.warmup; warmup += 1) {
    runSample(adapter, workload, values, options, iterations);
  }

  const samples: Sample[] = [];

  for (let round = 0; round < options.rounds; round += 1) {
    samples.push(runSample(adapter, workload, values, options, iterations));
  }

  const latencies = samples.map((sample) => sample.latencyMs);
  const throughputs = samples.map((sample) => sample.operationsPerSecond);
  const averageMemoryDelta = (key: keyof Sample['memoryDeltaBytes']): number | null => {
    const values = samples
      .map((sample) => sample.memoryDeltaBytes[key])
      .filter((value): value is number => value !== null);

    return values.length === 0
      ? null
      : values.reduce((total, value) => total + value, 0) / values.length;
  };
  const checksum = samples.reduce((total, sample) => total + sample.checksum, 0);

  return {
    adapter: adapter.name,
    workload,
    size: options.size,
    rounds: options.rounds,
    iterations,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
    },
    operationsPerSecond: percentile(throughputs, 50),
    memoryDeltaBytes: {
      heapUsed: averageMemoryDelta('heapUsed'),
      external: averageMemoryDelta('external'),
      arrayBuffers: averageMemoryDelta('arrayBuffers'),
      rss: averageMemoryDelta('rss'),
    },
    checksum,
  };
}
