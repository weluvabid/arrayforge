import type { BenchmarkResult } from './types.ts';

function escapeCsv(value: string | number | null): string {
  const text = value === null ? '' : String(value);

  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function toCsv(results: readonly BenchmarkResult[]): string {
  const columns = [
    'adapter',
    'workload',
    'size',
    'rounds',
    'iterations',
    'latency_p50_ms',
    'latency_p95_ms',
    'latency_p99_ms',
    'operations_per_second',
    'heap_used_delta_bytes',
    'external_delta_bytes',
    'array_buffers_delta_bytes',
    'rss_delta_bytes',
    'checksum',
  ];
  const rows = results.map((result) =>
    [
      result.adapter,
      result.workload,
      result.size,
      result.rounds,
      result.iterations,
      result.latencyMs.p50,
      result.latencyMs.p95,
      result.latencyMs.p99,
      result.operationsPerSecond,
      result.memoryDeltaBytes.heapUsed,
      result.memoryDeltaBytes.external,
      result.memoryDeltaBytes.arrayBuffers,
      result.memoryDeltaBytes.rss,
      result.checksum,
    ]
      .map(escapeCsv)
      .join(','),
  );

  return [columns.join(','), ...rows].join('\n');
}

export function printTable(results: readonly BenchmarkResult[]): string {
  const rows = results.map((result) => ({
    adapter: result.adapter,
    workload: result.workload,
    size: result.size.toLocaleString('en-US'),
    'p50 ms': result.latencyMs.p50.toFixed(3),
    'p95 ms': result.latencyMs.p95.toFixed(3),
    'p99 ms': result.latencyMs.p99.toFixed(3),
    'ops/sec': Math.round(result.operationsPerSecond).toLocaleString('en-US'),
    'heap Δ MB':
      result.memoryDeltaBytes.heapUsed === null
        ? 'n/a'
        : (result.memoryDeltaBytes.heapUsed / 1_048_576).toFixed(2),
    'buffers Δ MB':
      result.memoryDeltaBytes.arrayBuffers === null
        ? 'n/a'
        : (result.memoryDeltaBytes.arrayBuffers / 1_048_576).toFixed(2),
  }));

  if (rows.length === 0) {
    return 'No benchmark results.';
  }

  const headers = Object.keys(rows[0] ?? {});
  const widths = headers.map((header) =>
    Math.max(header.length, ...rows.map((row) => row[header as keyof typeof row].length)),
  );
  const formatRow = (values: readonly string[]) =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join('  ');

  return [
    formatRow(headers),
    formatRow(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => formatRow(headers.map((header) => row[header as keyof typeof row]))),
  ].join('\n');
}
