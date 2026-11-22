import { createChanges, createRandom } from './random.ts';
import type { BenchmarkOptions, CollectionAdapter, WorkloadName } from './types.ts';

const EMPTY_CHANGES: ReturnType<typeof createChanges> = [];
const EMPTY_RETAINED: unknown[] = [];
const NO_RANDOM = (): number => 0;

export interface PreparedWorkload {
  readonly random: () => number;
  readonly changes: ReturnType<typeof createChanges>;
  readonly alternateChanges: ReturnType<typeof createChanges>;
  readonly retained: unknown[];
}

export function prepareWorkload(
  _workload: WorkloadName,
  options: BenchmarkOptions,
): PreparedWorkload {
  const needsRandom =
    _workload === 'point-read' ||
    _workload === 'point-update' ||
    _workload === 'mixed-operations' ||
    _workload === 'mutation-churn';
  const changes =
    _workload === 'batch-update'
      ? createChanges(options.size, Math.min(1_000, options.size), options.seed)
      : EMPTY_CHANGES;

  return {
    random: needsRandom ? createRandom(options.seed) : NO_RANDOM,
    changes,
    alternateChanges:
      _workload === 'batch-update'
        ? changes.map((change) => ({
            index: change.index,
            value: options.size + change.value,
          }))
        : EMPTY_CHANGES,
    retained: _workload === 'snapshot' ? [] : EMPTY_RETAINED,
  };
}

export interface WorkloadRun {
  readonly collection: unknown;
  readonly checksum: number;
  readonly retained: readonly unknown[];
}

export function defaultIterations(workload: WorkloadName, size: number): number {
  const scale = size <= 100_000 ? 1 : size <= 1_000_000 ? 0.5 : 0.1;

  switch (workload) {
    case 'construction':
      return 1;
    case 'point-read':
      return 1_000;
    case 'snapshot':
      return Math.max(1, Math.floor(10 * scale));
    case 'sequential-iteration':
    case 'sequential-visit':
      return 1;
    case 'mixed-operations':
      return size <= 100_000 ? 256 : size <= 1_000_000 ? 128 : 32;
    case 'mutation-churn':
      return size <= 100_000 ? 2_000 : size <= 1_000_000 ? 500 : 100;
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
  prepared: PreparedWorkload = prepareWorkload(workload, options),
): WorkloadRun {
  let collection = initial;
  let checksum = 0;
  const retained = prepared.retained;
  const random = prepared.random;
  const { changes, alternateChanges } = prepared;

  switch (workload) {
    case 'construction': {
      checksum = adapter.length(collection);
      break;
    }

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
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const length = adapter.length(collection);

        if (length === 0) {
          break;
        }

        const index = Math.floor(length / 2);
        checksum += adapter.get(collection, index) ?? 0;
        collection = adapter.delete(collection, index);
      }

      break;
    }

    case 'batch-update': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        collection = adapter.updateMany(
          collection,
          iteration % 2 === 0 ? changes : alternateChanges,
        );
        checksum += adapter.length(collection);
      }

      break;
    }

    case 'range-delete': {
      const start = Math.floor(options.size / 4);
      const deleteCount = Math.max(1, Math.floor(options.size / 100));

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const length = adapter.length(collection);
        const end = Math.min(length, start + deleteCount);

        if (start >= end) {
          break;
        }

        collection = adapter.deleteRange(collection, start, end);
        checksum += adapter.length(collection);
      }

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

    case 'sequential-visit': {
      if (!adapter.forEach) {
        throw new Error(`Adapter ${adapter.name} does not support direct visitation.`);
      }

      for (let iteration = 0; iteration < iterations; iteration += 1) {
        adapter.forEach(collection, (value) => {
          checksum += value;
        });
      }

      break;
    }

    case 'mutation-churn': {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const length = adapter.length(collection);

        if (length === 0) {
          break;
        }

        const deleteIndex = Math.floor(random() * length);
        const deleted = adapter.get(collection, deleteIndex) ?? 0;
        collection = adapter.delete(collection, deleteIndex);
        const insertIndex = Math.floor(random() * (adapter.length(collection) + 1));
        collection = adapter.insert(collection, insertIndex, options.size + iteration);
        checksum += deleted + (adapter.get(collection, insertIndex) ?? 0);
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
  'construction',
  'point-read',
  'point-update',
  'point-insert',
  'point-delete',
  'batch-update',
  'range-delete',
  'snapshot',
  'sequential-iteration',
  'sequential-visit',
  'mixed-operations',
  'mutation-churn',
];
