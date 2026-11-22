import type { Change, CollectionAdapter } from '../benchmark/types.ts';

function copySet(collection: number[], index: number, value: number): number[] {
  const next = collection.slice();
  next[index] = value;

  return next;
}

function copyInsert(collection: number[], index: number, value: number): number[] {
  const next = collection.slice();
  next.splice(index, 0, value);

  return next;
}

function copyDelete(collection: number[], index: number): number[] {
  const next = collection.slice();
  next.splice(index, 1);

  return next;
}

function copyDeleteRange(collection: number[], start: number, end: number): number[] {
  const next = collection.slice();
  next.splice(start, end - start);

  return next;
}

function copyUpdateMany(collection: number[], changes: readonly Change[]): number[] {
  const next = collection.slice();

  for (const change of changes) {
    next[change.index] = change.value;
  }

  return next;
}

export const nativeCopyAdapter: CollectionAdapter = {
  name: 'native-copy',
  description: 'Native arrays with copy-on-write implemented using slice and splice.',
  create: (values) => values.slice(),
  length: (collection) => (collection as number[]).length,
  get: (collection, index) => (collection as number[])[index],
  set: (collection, index, value) => copySet(collection as number[], index, value),
  insert: (collection, index, value) => copyInsert(collection as number[], index, value),
  delete: (collection, index) => copyDelete(collection as number[], index),
  deleteRange: (collection, start, end) => copyDeleteRange(collection as number[], start, end),
  updateMany: (collection, changes) => copyUpdateMany(collection as number[], changes),
  snapshot: (collection) => (collection as number[]).slice(),
  iterate: (collection) => collection as number[],
  forEach: (collection, callback) => (collection as number[]).forEach(callback),
};

export const nativeMutableAdapter: CollectionAdapter = {
  name: 'native-mutable',
  description: 'Native arrays updated in place as a mutable throughput reference.',
  create: (values) => values.slice(),
  length: (collection) => (collection as number[]).length,
  get: (collection, index) => (collection as number[])[index],
  set: (collection, index, value) => {
    (collection as number[])[index] = value;

    return collection;
  },
  insert: (collection, index, value) => {
    (collection as number[]).splice(index, 0, value);

    return collection;
  },
  delete: (collection, index) => {
    (collection as number[]).splice(index, 1);

    return collection;
  },
  deleteRange: (collection, start, end) => {
    (collection as number[]).splice(start, end - start);

    return collection;
  },
  updateMany: (collection, changes) => {
    const values = collection as number[];

    for (const change of changes) {
      values[change.index] = change.value;
    }

    return values;
  },
  snapshot: (collection) => (collection as number[]).slice(),
  iterate: (collection) => collection as number[],
  forEach: (collection, callback) => (collection as number[]).forEach(callback),
};
