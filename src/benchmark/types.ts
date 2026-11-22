export interface Change {
  readonly index: number;
  readonly value: number;
}

export interface CollectionAdapter {
  readonly name: string;
  readonly description: string;
  create(values: number[]): unknown;
  length(collection: unknown): number;
  get(collection: unknown, index: number): number | undefined;
  set(collection: unknown, index: number, value: number): unknown;
  insert(collection: unknown, index: number, value: number): unknown;
  delete(collection: unknown, index: number): unknown;
  deleteRange(collection: unknown, start: number, end: number): unknown;
  updateMany(collection: unknown, changes: readonly Change[]): unknown;
  snapshot(collection: unknown): unknown;
  iterate(collection: unknown): Iterable<number>;
}

export type WorkloadName =
  | 'point-read'
  | 'point-update'
  | 'point-insert'
  | 'point-delete'
  | 'batch-update'
  | 'range-delete'
  | 'snapshot'
  | 'sequential-iteration'
  | 'mixed-operations';

export interface BenchmarkOptions {
  readonly size: number;
  readonly rounds: number;
  readonly warmup: number;
  readonly seed: number;
  readonly targetSampleMs?: number;
}

export interface BenchmarkResult {
  readonly adapter: string;
  readonly workload: WorkloadName;
  readonly size: number;
  readonly rounds: number;
  readonly iterations: number;
  readonly targetSampleMs: number;
  readonly sampleDurationMs: number;
  readonly explicitGc: boolean;
  readonly latencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly operationsPerSecond: number;
  readonly memoryDeltaBytes: {
    readonly heapUsed: number | null;
    readonly external: number | null;
    readonly arrayBuffers: number | null;
    readonly rss: number | null;
  };
  readonly checksum: number;
}

export interface AdapterLoadResult {
  readonly adapter: CollectionAdapter | null;
  readonly reason?: string;
}
