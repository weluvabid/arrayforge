import { performance } from 'node:perf_hooks';
import { createValues } from './random.ts';
import { defaultIterations, prepareWorkload, runWorkload } from './workloads.ts';
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
  readonly durationMs: number;
  readonly operationsPerSecond: number;
  readonly memoryDeltaBytes: {
    readonly heapUsed: number | null;
    readonly external: number | null;
    readonly arrayBuffers: number | null;
    readonly rss: number | null;
  };
  readonly checksum: number;
  readonly structure: BenchmarkResult['structure'];
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

function hasExplicitGarbageCollection(): boolean {
  const runtime = globalThis as typeof globalThis & { gc?: () => void };

  return typeof runtime.gc === 'function';
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
  const prepared = prepareWorkload(workload, options);
  collectGarbage();

  const memoryBefore = collectMemory();
  let collection: unknown;
  let run: ReturnType<typeof runWorkload>;
  let elapsedMs: number;

  if (workload === 'construction') {
    const startedAt = performance.now();

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      collection = adapter.create(values);
    }

    elapsedMs = Math.max(performance.now() - startedAt, 0.000_001);
    run = runWorkload(adapter, workload, collection, options, iterations, prepared);
  } else {
    collection = adapter.create(values);
    const startedAt = performance.now();
    run = runWorkload(adapter, workload, collection, options, iterations, prepared);
    elapsedMs = Math.max(performance.now() - startedAt, 0.000_001);
  }

  const checksum =
    workload === 'construction' ? run.checksum : run.checksum + adapter.length(run.collection);
  const structure = adapter.inspect?.(run.collection) ?? null;
  collection = undefined;
  collectGarbage();

  const memoryAfter = collectMemory();

  return {
    latencyMs: elapsedMs / iterations,
    durationMs: elapsedMs,
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
    checksum,
    structure,
  };
}

const DEFAULT_TARGET_SAMPLE_MS = 25;

export function maximumIterations(workload: WorkloadName, size: number): number {
  switch (workload) {
    case 'construction':
      return 20;
    case 'point-read':
      return 100_000;
    case 'point-update':
    case 'batch-update':
    case 'mixed-operations':
      return 10_000;
    case 'point-insert':
      return 10_000;
    case 'mutation-churn':
      return 50_000;
    case 'point-delete':
      return Math.min(10_000, size);
    case 'range-delete': {
      const start = Math.floor(size / 4);
      const deleteCount = Math.max(1, Math.floor(size / 100));

      return Math.max(1, Math.ceil((size - start) / deleteCount));
    }
    case 'snapshot':
      return 1_000;
    case 'sequential-iteration':
    case 'sequential-visit':
      return 1_000;
  }
}

function calibrateIterations(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  values: number[],
  options: BenchmarkOptions,
  initialIterations: number,
  targetSampleMs: number,
): number {
  const measureProbe = (iterations: number): number => {
    const prepared = prepareWorkload(workload, options);

    if (workload === 'construction') {
      const startedAt = performance.now();

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        adapter.create(values);
      }

      return Math.max(performance.now() - startedAt, 0.001);
    }

    const collection = adapter.create(values);
    const startedAt = performance.now();
    runWorkload(adapter, workload, collection, options, iterations, prepared);

    return Math.max(performance.now() - startedAt, 0.001);
  };
  const probeDurations = [
    measureProbe(initialIterations),
    measureProbe(initialIterations),
    measureProbe(initialIterations),
  ];
  const elapsedMs = percentile(probeDurations, 50);
  const maximum = maximumIterations(workload, options.size);
  const estimated = Math.min(
    maximum,
    Math.max(initialIterations, Math.ceil((initialIterations * targetSampleMs) / elapsedMs)),
  );

  if (estimated === initialIterations || estimated === maximum) {
    return estimated;
  }

  const calibratedDuration = measureProbe(estimated);

  return Math.min(
    maximum,
    Math.max(initialIterations, Math.ceil((estimated * targetSampleMs) / calibratedDuration)),
  );
}

export function benchmark(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  options: BenchmarkOptions,
  requestedIterations?: number,
): BenchmarkResult {
  const values = createValues(options.size);
  const targetSampleMs = Math.max(1, options.targetSampleMs ?? DEFAULT_TARGET_SAMPLE_MS);
  const initialIterations = Math.min(
    requestedIterations ?? defaultIterations(workload, options.size),
    maximumIterations(workload, options.size),
  );

  for (let warmup = 0; warmup < options.warmup; warmup += 1) {
    runSample(adapter, workload, values, options, initialIterations);
  }

  const iterations =
    requestedIterations === undefined
      ? calibrateIterations(adapter, workload, values, options, initialIterations, targetSampleMs)
      : initialIterations;
  const samples: Sample[] = [];

  for (let round = 0; round < options.rounds; round += 1) {
    samples.push(runSample(adapter, workload, values, options, iterations));
  }

  const latencies = samples.map((sample) => sample.latencyMs);
  const throughputs = samples.map((sample) => sample.operationsPerSecond);
  const durations = samples.map((sample) => sample.durationMs);
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
    status: 'completed',
    adapter: adapter.name,
    workload,
    size: options.size,
    rounds: options.rounds,
    iterations,
    targetSampleMs,
    sampleDurationMs: percentile(durations, 50),
    explicitGc: hasExplicitGarbageCollection(),
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
    structure: samples.find((sample) => sample.structure !== null)?.structure ?? null,
  };
}
