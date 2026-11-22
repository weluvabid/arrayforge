import { BPlusVector, RrbVector, type TreeOptions } from '../persistent/tree.ts';
import type { CollectionAdapter } from '../benchmark/types.ts';

function createAdapter(
  name: string,
  description: string,
  create: (values: readonly number[]) => ReturnType<typeof BPlusVector.from<number>>,
): CollectionAdapter {
  return {
    name,
    description,
    create: (values) => create(values),
    length: (collection) => (collection as ReturnType<typeof BPlusVector.from<number>>).length,
    get: (collection, index) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).get(index),
    set: (collection, index, value) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).set(index, value),
    insert: (collection, index, value) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).insert(index, value),
    delete: (collection, index) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).delete(index),
    deleteRange: (collection, start, end) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).deleteRange(start, end),
    updateMany: (collection, changes) => {
      let next = collection as ReturnType<typeof BPlusVector.from<number>>;

      for (const change of changes) {
        next = next.set(change.index, change.value);
      }

      return next;
    },
    snapshot: (collection) =>
      (collection as ReturnType<typeof BPlusVector.from<number>>).snapshot(),
    iterate: (collection) => collection as Iterable<number>,
  };
}

export function createPersistentTreeAdapters(options: TreeOptions = {}): CollectionAdapter[] {
  const pageCapacity = options.pageCapacity ?? 512;
  const configuredOptions = { ...options, pageCapacity };

  return [
    createAdapter(
      `bplus-${pageCapacity}`,
      `Persistent B+ tree with ${pageCapacity}-element reference pages.`,
      (values) => BPlusVector.from(values, configuredOptions),
    ),
    createAdapter(
      `rrb-${pageCapacity}`,
      `Relaxed radix-balanced tree with ${pageCapacity}-element reference pages.`,
      (values) => RrbVector.from(values, configuredOptions),
    ),
  ];
}

export const persistentTreeAdapters = [
  ...createPersistentTreeAdapters({ pageCapacity: 256 }),
  ...createPersistentTreeAdapters({ pageCapacity: 512 }),
  ...createPersistentTreeAdapters({ pageCapacity: 1024 }),
];
