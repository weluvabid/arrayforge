import { nativeCopyAdapter } from '../../src/adapters/native.ts';
import { persistentTreeAdapters } from '../../src/adapters/persistent-tree.ts';
import {
  immerBrowserAdapter,
  immutableBrowserAdapter,
  mutativeBrowserAdapter,
} from './adapters.ts';
import { createValues } from '../../src/benchmark/random.ts';
import { defaultIterations, prepareWorkload, runWorkload } from '../../src/benchmark/workloads.ts';
import type {
  BenchmarkOptions,
  BenchmarkResult,
  CollectionAdapter,
  WorkloadName,
} from '../../src/benchmark/types.ts';

interface RunMessage {
  readonly type: 'run';
  readonly runId: number;
  readonly workload: WorkloadName;
  readonly options: BenchmarkOptions;
  readonly skipAdapters: readonly string[];
}

const adapters: readonly CollectionAdapter[] = [
  nativeCopyAdapter,
  immerBrowserAdapter,
  mutativeBrowserAdapter,
  immutableBrowserAdapter,
  ...persistentTreeAdapters,
];

function percentile(values: readonly number[], percent: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function runAdapter(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  options: BenchmarkOptions,
  values: number[],
): BenchmarkResult {
  const iterations = defaultIterations(workload, options.size);
  const samples: number[] = [];
  let checksum = 0;
  let structure: BenchmarkResult['structure'] = null;

  for (let warmup = 0; warmup < options.warmup; warmup += 1) {
    const prepared = prepareWorkload(workload, options);
    runWorkload(adapter, workload, adapter.create(values), options, iterations, prepared);
  }

  for (let round = 0; round < options.rounds; round += 1) {
    const prepared = prepareWorkload(workload, options);
    let collection: unknown;
    let run: ReturnType<typeof runWorkload>;
    let elapsed: number;

    if (workload === 'construction') {
      const startedAt = performance.now();
      collection = adapter.create(values);
      elapsed = performance.now() - startedAt;
      run = runWorkload(adapter, workload, collection, options, iterations, prepared);
    } else {
      collection = adapter.create(values);
      const startedAt = performance.now();
      run = runWorkload(adapter, workload, collection, options, iterations, prepared);
      elapsed = performance.now() - startedAt;
    }

    structure = adapter.inspect?.(run.collection) ?? null;
    samples.push(elapsed / iterations);
    checksum +=
      workload === 'construction' ? run.checksum : run.checksum + adapter.length(run.collection);
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  return {
    status: 'completed',
    adapter: adapter.name,
    workload,
    size: options.size,
    rounds: options.rounds,
    iterations,
    targetSampleMs: options.targetSampleMs ?? 0,
    sampleDurationMs: p50 * iterations,
    explicitGc: false,
    latencyMs: { p50, p95, p99 },
    operationsPerSecond: p50 > 0 ? 1_000 / p50 : Number.NaN,
    memoryDeltaBytes: { heapUsed: null, external: null, arrayBuffers: null, rss: null },
    checksum,
    structure,
  };
}

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RunMessage>) => void): void;
}

const workerScope = self as unknown as WorkerScope;

function post(message: Record<string, unknown>): void {
  workerScope.postMessage(message);
}

workerScope.addEventListener('message', async (event: MessageEvent<RunMessage>) => {
  const message = event.data;

  if (message.type !== 'run') {
    return;
  }

  try {
    const pendingAdapters = adapters.filter(
      (adapter) => !message.skipAdapters.includes(adapter.name),
    );
    post({ type: 'start', runId: message.runId, total: adapters.length });

    if (pendingAdapters.length === 0) {
      post({ type: 'complete', runId: message.runId });
      return;
    }

    const values = createValues(message.options.size);

    for (let index = 0; index < pendingAdapters.length; index += 1) {
      const adapter = pendingAdapters[index];

      if (!adapter) {
        continue;
      }

      post({ type: 'adapter-start', runId: message.runId, adapter: adapter.name });
      const result = runAdapter(adapter, message.workload, message.options, values);
      post({ type: 'result', runId: message.runId, result });
      post({
        type: 'progress',
        runId: message.runId,
        completed: adapters.length - pendingAdapters.length + index + 1,
        total: adapters.length,
        adapter: adapter.name,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    post({ type: 'complete', runId: message.runId });
  } catch (error) {
    post({
      type: 'error',
      runId: message.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
