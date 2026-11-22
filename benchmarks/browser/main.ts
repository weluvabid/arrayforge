import type {
  BenchmarkOptions,
  BenchmarkResult,
  BenchmarkRunResult,
  WorkloadName,
} from '../../src/benchmark/types.ts';
import './styles/input.css';
import { browserAdapterNames } from './adapter-names.ts';
import { icons } from './ui/icons.ts';
import { adapterLabel, denseRanks, rankedResults } from './ranking.ts';

interface WorkerStart {
  readonly type: 'start';
  readonly runId: number;
  readonly total: number;
}

interface WorkerAdapterStart {
  readonly type: 'adapter-start';
  readonly runId: number;
  readonly adapter: string;
}

interface WorkerProgress {
  readonly type: 'progress';
  readonly runId: number;
  readonly completed: number;
  readonly total: number;
  readonly adapter: string;
}

interface WorkerResult {
  readonly type: 'result';
  readonly runId: number;
  readonly result: BenchmarkResult;
}

interface WorkerComplete {
  readonly type: 'complete';
  readonly runId: number;
}

interface WorkerError {
  readonly type: 'error';
  readonly runId: number;
  readonly error: string;
}

type WorkerMessage =
  WorkerStart | WorkerAdapterStart | WorkerProgress | WorkerResult | WorkerComplete | WorkerError;

const sizeInput = requireElement(document.querySelector<HTMLSelectElement>('#size'), '#size');
const workloadInput = requireElement(
  document.querySelector<HTMLSelectElement>('#workload'),
  '#workload',
);
const roundsInput = requireElement(document.querySelector<HTMLSelectElement>('#rounds'), '#rounds');
const runButton = requireElement(document.querySelector<HTMLButtonElement>('#run'), '#run');
const downloadButton = requireElement(
  document.querySelector<HTMLButtonElement>('#download'),
  '#download',
);
const status = requireElement(document.querySelector<HTMLElement>('#status'), '#status');
const runtimeDot = requireElement(
  document.querySelector<HTMLElement>('.runtime-dot'),
  '.runtime-dot',
);
const resultsBody = requireElement(
  document.querySelector<HTMLTableSectionElement>('#results'),
  '#results',
);
const progress = requireElement(
  document.querySelector<HTMLProgressElement>('#progress'),
  '#progress',
);
const progressLabel = requireElement(
  document.querySelector<HTMLElement>('#progress-label'),
  '#progress-label',
);

let latestResults: BenchmarkRunResult[] = [];
let activeWorker: Worker | null = null;
let activeRunId = 0;
let activeAdapterTimer: number | null = null;
let activeAdapter: string | null = null;
let currentOptions: BenchmarkOptions | null = null;
let currentWorkload: WorkloadName | null = null;
const adapterTimeoutMs = 2_000;
let skippedAdapters = new Set<string>();
let hadAdapterFailure = false;
let hadAdapterTimeout = false;

function requireElement<T extends Element>(element: T | null, selector: string): T {
  if (!element) {
    throw new Error(`Missing page element: ${selector}`);
  }

  return element;
}

function displayLatency(value: number): string {
  return value < 0.001 ? '< 0.001 ms' : `${value.toFixed(3)} ms`;
}

function displayThroughput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return 'Below timer resolution';
  }

  return value >= 1_000_000_000 ? '1,000,000,000+' : Math.round(value).toLocaleString();
}

function completedResults(results: readonly BenchmarkRunResult[]): BenchmarkResult[] {
  return results.filter((result): result is BenchmarkResult => result.status === 'completed');
}

function clearAdapterTimer(): void {
  if (activeAdapterTimer !== null) {
    window.clearTimeout(activeAdapterTimer);
  }

  activeAdapterTimer = null;
  activeAdapter = null;
}

function renderResults(results: readonly BenchmarkRunResult[]): void {
  const completed = completedResults(results);
  const ranked = rankedResults(completed);
  const ranks = denseRanks(completed);
  resultsBody.replaceChildren();

  if (ranked.length === 0 && results.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'px-4 py-[34px] text-center text-[var(--af-muted-foreground)]';
    cell.textContent = 'Choose a workload and run the benchmark.';
    row.append(cell);
    resultsBody.append(row);
    return;
  }

  for (const [index, result] of ranked.entries()) {
    const row = document.createElement('tr');
    const rank = document.createElement('td');
    rank.className = 'w-[58px] font-mono tabular-nums text-[var(--af-muted-foreground)]';
    rank.textContent = String(ranks.get(result.adapter) ?? index + 1).padStart(2, '0');
    const adapter = document.createElement('td');
    adapter.className = 'min-w-[180px] font-bold';
    adapter.textContent = adapterLabel(result.adapter);
    const p50 = document.createElement('td');
    p50.className = 'text-right font-mono tabular-nums';
    p50.textContent = displayLatency(result.latencyMs.p50);
    const p95 = document.createElement('td');
    p95.className = 'text-right font-mono tabular-nums';
    p95.textContent = displayLatency(result.latencyMs.p95);
    const p99 = document.createElement('td');
    p99.className = 'text-right font-mono tabular-nums';
    p99.textContent = displayLatency(result.latencyMs.p99);
    const throughput = document.createElement('td');
    throughput.className = 'text-right font-mono tabular-nums';
    throughput.textContent = displayThroughput(result.operationsPerSecond);
    row.append(rank, adapter, p50, p95, p99, throughput);
    resultsBody.append(row);
  }

  for (const result of results) {
    if (result.status !== 'timeout') {
      continue;
    }

    const row = document.createElement('tr');
    row.className = 'timeout-row';
    const rank = document.createElement('td');
    rank.className = 'w-[58px] font-mono tabular-nums text-[var(--af-muted-foreground)]';
    rank.textContent = '—';
    const adapter = document.createElement('td');
    adapter.className = 'min-w-[180px] font-bold';
    adapter.textContent = adapterLabel(result.adapter);
    const timeoutBadge = document.createElement('span');
    timeoutBadge.className = 'badge badge-outline badge-sm';
    timeoutBadge.textContent = 'Timed out';
    adapter.append(' ', timeoutBadge);
    const detail = document.createElement('td');
    detail.colSpan = 4;
    detail.className = 'text-right text-sm';
    detail.textContent = `Exceeded ${result.timeoutMs / 1_000}s adapter limit`;
    row.append(rank, adapter, detail);
    resultsBody.append(row);
  }
}

function setRunning(running: boolean): void {
  downloadButton.disabled = running || latestResults.length === 0;
  sizeInput.disabled = running;
  workloadInput.disabled = running;
  roundsInput.disabled = running;
  const state = running
    ? 'running'
    : hadAdapterTimeout
      ? 'failed'
      : hadAdapterFailure
        ? 'error'
        : 'ready';
  const tooltip =
    state === 'running'
      ? 'Running'
      : state === 'failed'
        ? 'Some adapters timed out'
        : state === 'error'
          ? 'Benchmark failed'
          : 'Ready';
  runtimeDot.dataset['state'] = state;
  runtimeDot.dataset['tip'] = tooltip;
  runtimeDot.setAttribute('aria-label', tooltip);
  const action = running ? 'Cancel' : 'Play';
  runButton.dataset['tip'] = action;
  runButton.setAttribute('aria-label', action);
  runButton.innerHTML = running ? icons.x : icons.play;
}

function downloadResults(): void {
  const content = JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      adapterTimeoutMs,
      results: latestResults,
      ranking: (() => {
        const ranked = rankedResults(completedResults(latestResults));
        const ranks = denseRanks(ranked);
        return ranked.map((result) => ({ rank: ranks.get(result.adapter), ...result }));
      })(),
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

function finishRun(message: string, failed = false): void {
  clearAdapterTimer();
  activeWorker?.terminate();
  activeWorker = null;
  hadAdapterFailure ||= failed;
  renderResults(latestResults);
  progress.value = skippedAdapters.size + completedResults(latestResults).length;
  progressLabel.textContent = `${progress.max} of ${progress.max} adapters processed`;
  status.textContent = message;
  setRunning(false);
}

function startWorker(runId: number): void {
  if (!currentOptions || !currentWorkload) {
    return;
  }

  const options = currentOptions;
  const workload = currentWorkload;
  let worker: Worker;

  try {
    worker = new Worker(new URL('./benchmark.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    finishRun(error instanceof Error ? error.message : String(error), true);
    return;
  }

  activeWorker = worker;
  const completedOrSkipped = new Set([
    ...skippedAdapters,
    ...latestResults.map((result) => result.adapter),
  ]);
  const skip = [...completedOrSkipped];

  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    if (message.runId !== runId || activeWorker !== worker) {
      return;
    }

    if (message.type === 'start') {
      progress.max = message.total;
      progress.value = skippedAdapters.size + completedResults(latestResults).length;
      progressLabel.textContent = 'Preparing dataset…';
      status.textContent = `Preparing ${options.size.toLocaleString()} values in the benchmark worker…`;
      return;
    }

    if (message.type === 'adapter-start') {
      clearAdapterTimer();
      activeAdapter = message.adapter;
      status.textContent = `Running ${adapterLabel(message.adapter)}…`;
      progressLabel.textContent = `${skippedAdapters.size + completedResults(latestResults).length} of ${browserAdapterNames.length} · ${adapterLabel(message.adapter)}`;
      activeAdapterTimer = window.setTimeout(() => {
        if (activeWorker !== worker || activeAdapter !== message.adapter) {
          return;
        }

        worker.terminate();
        activeWorker = null;
        clearAdapterTimer();
        latestResults.push({
          status: 'timeout',
          adapter: message.adapter,
          workload,
          size: options.size,
          timeoutMs: adapterTimeoutMs,
        });
        skippedAdapters.add(message.adapter);
        hadAdapterFailure = true;
        hadAdapterTimeout = true;
        progress.value = skippedAdapters.size + completedResults(latestResults).length;
        progressLabel.textContent = `${progress.value} of ${browserAdapterNames.length} · ${adapterLabel(message.adapter)} timed out`;
        status.textContent = `${adapterLabel(message.adapter)} exceeded the 2-second limit. Continuing…`;
        renderResults(latestResults);
        startWorker(runId);
      }, adapterTimeoutMs);
      return;
    }

    if (message.type === 'progress') {
      clearAdapterTimer();
      progress.value = skippedAdapters.size + completedResults(latestResults).length;
      progress.max = message.total;
      progressLabel.textContent = `${progress.value} of ${message.total} · ${message.adapter}`;
      status.textContent = 'Benchmarking in the background worker…';
      return;
    }

    if (message.type === 'result') {
      clearAdapterTimer();
      latestResults.push(message.result);
      renderResults(latestResults);
      return;
    }

    if (message.type === 'complete') {
      finishRun('Benchmark complete.');
      return;
    }

    finishRun(message.error);
  });

  worker.addEventListener('messageerror', () => {
    if (activeWorker !== worker) {
      return;
    }

    finishRun('The benchmark worker returned an unreadable message.', true);
  });

  worker.addEventListener('error', (event: ErrorEvent) => {
    if (activeWorker !== worker) {
      return;
    }

    finishRun(event.message || 'The benchmark worker failed.', true);
  });

  worker.postMessage({
    type: 'run',
    runId,
    workload: currentWorkload,
    options: currentOptions,
    skipAdapters: skip,
  });
}

function runBenchmarks(): void {
  if (activeWorker) {
    return;
  }

  const size = Number(sizeInput.value);
  currentWorkload = workloadInput.value as WorkloadName;
  const rounds = Number(roundsInput.value);
  currentOptions = { size, rounds, warmup: 2, seed: 42 };
  skippedAdapters = new Set();
  hadAdapterFailure = false;
  hadAdapterTimeout = false;
  const runId = ++activeRunId;

  latestResults = [];
  renderResults(latestResults);
  progress.value = 0;
  progress.max = browserAdapterNames.length;
  progressLabel.textContent = 'Starting worker…';
  status.textContent = `Preparing ${size.toLocaleString()} values for ${currentWorkload}.`;
  setRunning(true);

  try {
    startWorker(runId);
  } catch (error) {
    finishRun(error instanceof Error ? error.message : String(error), true);
  }
}

function cancelBenchmarks(): void {
  if (!activeWorker) {
    return;
  }

  clearAdapterTimer();
  activeWorker.terminate();
  activeWorker = null;
  activeRunId += 1;
  status.textContent = 'Benchmark cancelled.';
  progressLabel.textContent = 'Cancelled';
  setRunning(false);
}

function handleRunButtonClick(): void {
  if (activeWorker) {
    cancelBenchmarks();
    return;
  }

  runBenchmarks();
}

runButton.classList.add('tooltip', 'tooltip-bottom');
runButton.dataset['tip'] = 'Play';
runButton.title = 'Play';
runButton.setAttribute('aria-label', 'Play');
runButton.innerHTML = icons.play;
downloadButton.innerHTML = `${icons.download}<span>Export JSON</span>`;
runButton.addEventListener('click', handleRunButtonClick);
downloadButton.addEventListener('click', downloadResults);
