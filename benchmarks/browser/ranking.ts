import type { BenchmarkResult } from '../../src/benchmark/types.ts';
import { adapterPrecedence, browserAdapterLabels, browserAdapterNames } from './adapter-names.ts';

const DISPLAY_PRECISION_FLOOR_MS = 0.001;

function latencyKey(result: BenchmarkResult): string {
  return (['p50', 'p95', 'p99'] as const)
    .map((metric) => {
      const value = result.latencyMs[metric];
      return value < DISPLAY_PRECISION_FLOOR_MS ? '<0.001' : String(value);
    })
    .join(':');
}

function compareMetric(left: number, right: number): number {
  if (left < DISPLAY_PRECISION_FLOOR_MS && right < DISPLAY_PRECISION_FLOOR_MS) {
    return 0;
  }

  return left - right;
}

function precedence(adapter: string): number {
  return adapter in adapterPrecedence
    ? adapterPrecedence[adapter as keyof typeof adapterPrecedence]
    : 0;
}

export function adapterLabel(adapter: string): string {
  return adapter in browserAdapterLabels
    ? browserAdapterLabels[adapter as keyof typeof browserAdapterLabels]
    : adapter;
}

function compareLatency(left: BenchmarkResult, right: BenchmarkResult): number {
  for (const metric of ['p50', 'p95', 'p99'] as const) {
    const delta = compareMetric(left.latencyMs[metric], right.latencyMs[metric]);

    if (delta !== 0) {
      return delta;
    }
  }

  return (
    precedence(right.adapter) - precedence(left.adapter) ||
    left.adapter.localeCompare(right.adapter)
  );
}

/** Sort by displayed p50, p95 and p99 precision, then explicit adapter precedence for ties. */
export function rankedResults(results: readonly BenchmarkResult[]): BenchmarkResult[] {
  return [...results].sort(compareLatency);
}

/** Dense rank: values below display precision tie; explicit precedence orders those rows. */
export function denseRanks(results: readonly BenchmarkResult[]): Map<string, number> {
  const ranked = rankedResults(results);
  const ranks = new Map<string, number>();
  let rank = 0;
  let previousKey: string | null = null;

  for (const result of ranked) {
    const key = latencyKey(result);

    if (key !== previousKey) {
      rank += 1;
      previousKey = key;
    }

    ranks.set(result.adapter, rank);
  }

  return ranks;
}

export function adapterOrder(): readonly string[] {
  return browserAdapterNames;
}
