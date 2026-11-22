import { nativeCopyAdapter, nativeMutableAdapter } from '../../src/adapters/native.ts';
import {
  immerBrowserAdapter,
  immutableBrowserAdapter,
  mutativeBrowserAdapter,
} from './adapters.ts';
import { createValues } from '../../src/benchmark/random.ts';
import { defaultIterations, runWorkload } from '../../src/benchmark/workloads.ts';
import type {
  BenchmarkOptions,
  BenchmarkResult,
  CollectionAdapter,
  WorkloadName,
} from '../../src/benchmark/types.ts';

interface BrowserPerformance extends Performance {
  readonly memory?: {
    readonly usedJSHeapSize: number;
  };
}

const sizeInput = document.querySelector<HTMLSelectElement>('#size');
const workloadInput = document.querySelector<HTMLSelectElement>('#workload');
const roundsInput = document.querySelector<HTMLSelectElement>('#rounds');
const runButton = document.querySelector<HTMLButtonElement>('#run');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');
const status = document.querySelector<HTMLElement>('#status');
const resultsBody = document.querySelector<HTMLTableSectionElement>('#results');

let latestResults: BenchmarkResult[] = [];

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) {
    throw new Error(`Missing page element: ${selector}`);
  }

  return element;
}

function heapUsed(): number | null {
  return (performance as BrowserPerformance).memory?.usedJSHeapSize ?? null;
}

function percentile(values: readonly number[], percent: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);

  return sorted[index] ?? 0;
}

function runAdapter(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  options: BenchmarkOptions,
): BenchmarkResult {
  const values = createValues(options.size);
  const iterations = defaultIterations(workload, options.size);
  const samples: number[] = [];
  const heapDeltas: number[] = [];
  let checksum = 0;

  for (let warmup = 0; warmup < options.warmup; warmup += 1) {
    runWorkload(adapter, workload, adapter.create(values), options, iterations);
  }

  for (let round = 0; round < options.rounds; round += 1) {
    const before = heapUsed();
    const collection = adapter.create(values);
    const startedAt = performance.now();
    const run = runWorkload(adapter, workload, collection, options, iterations);
    const elapsed = Math.max(performance.now() - startedAt, 0.000_001);
    const after = heapUsed();

    samples.push(elapsed / iterations);
    checksum += run.checksum + adapter.length(run.collection);

    if (before !== null && after !== null) {
      heapDeltas.push(after - before);
    }
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const averageHeap =
    heapDeltas.length === 0
      ? null
      : heapDeltas.reduce((total, value) => total + value, 0) / heapDeltas.length;

  return {
    adapter: adapter.name,
    workload,
    size: options.size,
    rounds: options.rounds,
    iterations,
    latencyMs: { p50, p95, p99 },
    operationsPerSecond: 1_000 / p50,
    memoryDeltaBytes: {
      heapUsed: averageHeap,
      external: null,
      arrayBuffers: null,
      rss: null,
    },
    checksum,
  };
}

function renderResults(results: readonly BenchmarkResult[]): void {
  const body = requireElement(resultsBody, '#results');
  body.replaceChildren();

  for (const result of results) {
    const row = document.createElement('tr');
    const values = [
      result.adapter,
      `${result.latencyMs.p50.toFixed(3)} ms`,
      Math.round(result.operationsPerSecond).toLocaleString(),
      result.memoryDeltaBytes.heapUsed === null
        ? 'Unavailable'
        : `${(result.memoryDeltaBytes.heapUsed / 1_048_576).toFixed(2)} MB`,
      result.checksum.toLocaleString(),
    ];

    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    body.append(row);
  }
}

function downloadResults(): void {
  const content = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      results: latestResults,
    },
    null,
    2,
  );
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'arrayforge-browser-benchmark.json';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function runBenchmarks(): Promise<void> {
  const size = Number(requireElement(sizeInput, '#size').value);
  const workload = requireElement(workloadInput, '#workload').value as WorkloadName;
  const rounds = Number(requireElement(roundsInput, '#rounds').value);
  const button = requireElement(runButton, '#run');
  const statusElement = requireElement(status, '#status');
  const options: BenchmarkOptions = {
    size,
    rounds,
    warmup: 2,
    seed: 42,
  };
  const adapters = [
    nativeCopyAdapter,
    nativeMutableAdapter,
    immerBrowserAdapter,
    mutativeBrowserAdapter,
    immutableBrowserAdapter,
  ];

  button.disabled = true;
  latestResults = [];
  requireElement(downloadButton, '#download').disabled = true;
  statusElement.textContent = `Preparing ${size.toLocaleString()} values…`;
  requireElement(resultsBody, '#results').replaceChildren();

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  try {
    for (const adapter of adapters) {
      statusElement.textContent = `Running ${adapter.name}…`;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      latestResults.push(runAdapter(adapter, workload, options));
      renderResults(latestResults);
    }

    statusElement.textContent = 'Benchmark complete.';
    requireElement(downloadButton, '#download').disabled = false;
  } catch (error) {
    statusElement.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
}

requireElement(runButton, '#run').addEventListener('click', () => {
  runBenchmarks().catch((error: unknown) => {
    requireElement(status, '#status').textContent =
      error instanceof Error ? error.message : String(error);
  });
});
requireElement(downloadButton, '#download').addEventListener('click', downloadResults);
