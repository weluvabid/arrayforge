import { createChanges, createRandom } from './random.ts';
import type { BenchmarkOptions, CollectionAdapter, WorkloadName } from './types.ts';

export interface WorkloadRun {
  readonly collection: unknown;
  readonly checksum: number;
  readonly retained: readonly unknown[];
}

export function defaultIterations(workload: WorkloadName, size: number): number {
  const scale = size <= 100_000 ? 1 : size <= 1_000_000 ? 0.5 : 0.1;

  switch (workload) {
    case 'point-read':
      return 1_000;
    case 'snapshot':
      return Math.max(1, Math.floor(10 * scale));
    case 'sequential-iteration':
      return 1;
    case 'mixed-operations':
      return size <= 100_000 ? 256 : size <= 1_000_000 ? 128 : 32;
    case 'range-delete':
      return Math.max(1, Math.floor(3 * scale));
    case 'batch-update':
      return Math.max(1, Math.floor(10 * scale));
    default:
      return Math.max(1, Math.floor(10 * scale));
  }
}

export function runWorkload(
  adapter: CollectionAdapter,
  workload: WorkloadName,
  initial: unknown,
  options: BenchmarkOptions,
  iterations: number,
): WorkloadRun {
  let collection = initial;
  let checksum = 0;
  const retained: unknown[] = [];
  const random = createRandom(options.seed);
  const changes = createChanges(options.size, Math.min(1_000, options.size), options.seed);

  switch (workload) {
    case 'point-read': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const index = Math.floor(random() * adapter.length(collection));
        checksum += adapter.get(collection, index) ?? 0;
      }

      break;
    }

    case 'point-update': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const index = Math.floor(random() * adapter.length(collection));
        collection = adapter.set(collection, index, options.size + iteration);
        checksum += adapter.get(collection, index) ?? 0;
      }

      break;
    }

    case 'point-insert': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const index = Math.floor(adapter.length(collection) / 2);
        collection = adapter.insert(collection, index, options.size + iteration);
        checksum += adapter.length(collection);
      }

      break;
    }

    case 'point-delete': {
      const length = adapter.length(initial);
      const index = Math.floor(length / 2);
      let next = initial;

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        next = adapter.delete(initial, index);
        checksum += adapter.get(initial, index) ?? 0;
      }

      collection = next;
      break;
    }

    case 'batch-update': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        collection = adapter.updateMany(collection, changes);
        checksum += adapter.length(collection);
      }

      break;
    }

    case 'range-delete': {
      const length = adapter.length(initial);
      const start = Math.floor(length / 4);
      const end = Math.min(length, start + Math.max(1, Math.floor(options.size / 100)));
      let next = initial;

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        next = adapter.deleteRange(initial, start, end);
        checksum += adapter.length(next);
      }

      collection = next;
      break;
    }

    case 'snapshot': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        retained.push(adapter.snapshot(collection));
      }

      checksum = retained.length + adapter.length(collection);
      break;
    }

    case 'sequential-iteration': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        for (const value of adapter.iterate(collection)) {
          checksum += value;
        }
      }

      break;
    }

    case 'mixed-operations': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const length = adapter.length(collection);
        const choice = random();

        if (choice < 0.7 && length > 0) {
          const index = Math.floor(random() * length);
          checksum += adapter.get(collection, index) ?? 0;
        } else if (choice < 0.9 && length > 0) {
          const index = Math.floor(random() * length);
          collection = adapter.set(collection, index, options.size + iteration);
          checksum += options.size + iteration;
        } else if (choice < 0.95) {
          const index = Math.floor(random() * (length + 1));
          collection = adapter.insert(collection, index, options.size + iteration);
          checksum += adapter.length(collection);
        } else if (length > 0) {
          const index = Math.floor(random() * length);
          collection = adapter.delete(collection, index);
          checksum += adapter.length(collection);
        }
      }

      break;
    }
  }

  return { collection, checksum, retained };
}

export const workloadNames: readonly WorkloadName[] = [
  'point-read',
  'point-update',
  'point-insert',
  'point-delete',
  'batch-update',
  'range-delete',
  'snapshot',
  'sequential-iteration',
  'mixed-operations',
];
