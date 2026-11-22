import type { BenchmarkRunResult } from './types.ts';

function escapeCsv(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  return text.includes(',') || text.includes('"') || text.includes('\n')
    ? `"${text.replaceAll('"', '""')}"`
    : text;
}

export function toCsv(results: readonly BenchmarkRunResult[]): string {
  const columns = [
    'status',
    'adapter',
    'workload',
    'size',
    'timeout_ms',
    'rounds',
    'iterations',
    'target_sample_ms',
    'sample_duration_ms',
    'explicit_gc',
    'latency_p50_ms',
    'latency_p95_ms',
    'latency_p99_ms',
    'operations_per_second',
    'heap_used_delta_bytes',
    'external_delta_bytes',
    'array_buffers_delta_bytes',
    'rss_delta_bytes',
    'checksum',
    'nodes',
    'leaves',
    'branches',
    'height',
    'min_leaf_occupancy',
    'mean_leaf_occupancy',
    'max_leaf_occupancy',
    'min_branch_occupancy',
    'mean_branch_occupancy',
    'max_branch_occupancy',
  ];
  const rows = results.map((result) => {
    if (result.status === 'timeout') {
      return [
        result.status,
        result.adapter,
        result.workload,
        result.size,
        result.timeoutMs,
        ...Array.from({ length: columns.length - 5 }, () => null),
      ];
    }

    return [
      result.status,
      result.adapter,
      result.workload,
      result.size,
      null,
      result.rounds,
      result.iterations,
      result.targetSampleMs,
      result.sampleDurationMs,
      result.explicitGc,
      result.latencyMs.p50,
      result.latencyMs.p95,
      result.latencyMs.p99,
      result.operationsPerSecond,
      result.memoryDeltaBytes.heapUsed,
      result.memoryDeltaBytes.external,
      result.memoryDeltaBytes.arrayBuffers,
      result.memoryDeltaBytes.rss,
      result.checksum,
      result.structure?.nodes ?? null,
      result.structure?.leaves ?? null,
      result.structure?.branches ?? null,
      result.structure?.height ?? null,
      result.structure?.minLeafOccupancy ?? null,
      result.structure?.meanLeafOccupancy ?? null,
      result.structure?.maxLeafOccupancy ?? null,
      result.structure?.minBranchOccupancy ?? null,
      result.structure?.meanBranchOccupancy ?? null,
      result.structure?.maxBranchOccupancy ?? null,
    ];
  });
  return [columns.join(','), ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n');
}

export function printTable(results: readonly BenchmarkRunResult[]): string {
  if (results.length === 0) {
    return 'No benchmark results.';
  }

  const rows = results.map((result) =>
    result.status === 'timeout'
      ? {
          status: 'TIMEOUT',
          adapter: result.adapter,
          workload: result.workload,
          size: result.size.toLocaleString('en-US'),
          iterations: '—',
          'sample ms': '—',
          'timeout ms': result.timeoutMs.toLocaleString('en-US'),
          'explicit gc': '—',
          'p50 ms': '—',
          'p95 ms': '—',
          'p99 ms': '—',
          'ops/sec': '—',
          'heap Δ MB': '—',
          'buffers Δ MB': '—',
          nodes: '—',
          'leaf min/avg/max': '—',
          'branch min/avg/max': '—',
        }
      : {
          status: 'completed',
          adapter: result.adapter,
          workload: result.workload,
          size: result.size.toLocaleString('en-US'),
          iterations: result.iterations.toLocaleString('en-US'),
          'sample ms': result.sampleDurationMs.toFixed(1),
          'timeout ms': '—',
          'explicit gc': result.explicitGc ? 'yes' : 'no',
          'p50 ms': result.latencyMs.p50.toFixed(4),
          'p95 ms': result.latencyMs.p95.toFixed(4),
          'p99 ms': result.latencyMs.p99.toFixed(4),
          'ops/sec': Math.round(result.operationsPerSecond).toLocaleString('en-US'),
          'heap Δ MB':
            result.memoryDeltaBytes.heapUsed === null
              ? 'n/a'
              : (result.memoryDeltaBytes.heapUsed / 1_048_576).toFixed(2),
          'buffers Δ MB':
            result.memoryDeltaBytes.arrayBuffers === null
              ? 'n/a'
              : (result.memoryDeltaBytes.arrayBuffers / 1_048_576).toFixed(2),
          nodes: result.structure?.nodes.toLocaleString('en-US') ?? 'n/a',
          'leaf min/avg/max': result.structure
            ? `${result.structure.minLeafOccupancy}/${result.structure.meanLeafOccupancy.toFixed(1)}/${result.structure.maxLeafOccupancy}`
            : 'n/a',
          'branch min/avg/max': result.structure
            ? `${result.structure.minBranchOccupancy}/${result.structure.meanBranchOccupancy.toFixed(1)}/${result.structure.maxBranchOccupancy}`
            : 'n/a',
        },
  );

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
