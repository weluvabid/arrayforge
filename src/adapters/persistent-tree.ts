import {
  BPlusVector,
  RrbVector,
  type PersistentTreeVector,
  type TreeOptions,
} from '../persistent/tree.ts';
import type { CollectionAdapter } from '../benchmark/types.ts';

function createAdapter(
  name: string,
  description: string,
  create: (values: readonly number[]) => PersistentTreeVector<number>,
): CollectionAdapter {
  return {
    name,
    description,
    create: (values) => create(values),
    length: (collection) => (collection as PersistentTreeVector<number>).length,
    get: (collection, index) => (collection as PersistentTreeVector<number>).get(index),
    set: (collection, index, value) =>
      (collection as PersistentTreeVector<number>).set(index, value),
    insert: (collection, index, value) =>
      (collection as PersistentTreeVector<number>).insert(index, value),
    delete: (collection, index) => (collection as PersistentTreeVector<number>).delete(index),
    deleteRange: (collection, start, end) =>
      (collection as PersistentTreeVector<number>).deleteRange(start, end),
    updateMany: (collection, changes) =>
      (collection as PersistentTreeVector<number>).setMany(changes),
    snapshot: (collection) => (collection as PersistentTreeVector<number>).snapshot(),
    iterate: (collection) => collection as Iterable<number>,
  };
}

export function createPersistentTreeAdapters(options: TreeOptions = {}): CollectionAdapter[] {
  const pageSize = options.pageSize ?? 512;
  const configuredOptions = { ...options, pageSize };

  return [
    createAdapter(
      `bplus-${pageSize}`,
      `Persistent B+ tree with ${pageSize}-element reference pages.`,
      (values) => BPlusVector.from(values, configuredOptions),
    ),
    createAdapter(
      `rrb-${pageSize}`,
      `Relaxed radix-balanced tree with ${pageSize}-element reference pages.`,
      (values) => RrbVector.from(values, configuredOptions),
    ),
  ];
}

export const persistentTreeAdapters = [
  ...createPersistentTreeAdapters({ pageSize: 256 }),
  ...createPersistentTreeAdapters({ pageSize: 512 }),
  ...createPersistentTreeAdapters({ pageSize: 1024 }),
];
