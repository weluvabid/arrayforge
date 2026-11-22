import { produce } from 'immer';
import { List } from 'immutable';
import type { List as ImmutableList } from 'immutable';
import { create } from 'mutative';
import type { CollectionAdapter } from '../../src/benchmark/types.ts';

export const immerBrowserAdapter: CollectionAdapter = {
  name: 'immer',
  description: 'Immer produce with proxy-based copy-on-write.',
  create: (values) => values.slice(),
  length: (collection) => (collection as number[]).length,
  get: (collection, index) => (collection as number[])[index],
  set: (collection, index, value) =>
    produce(collection as number[], (draft) => {
      draft[index] = value;
    }),
  insert: (collection, index, value) =>
    produce(collection as number[], (draft) => {
      draft.splice(index, 0, value);
    }),
  delete: (collection, index) =>
    produce(collection as number[], (draft) => {
      draft.splice(index, 1);
    }),
  deleteRange: (collection, start, end) =>
    produce(collection as number[], (draft) => {
      draft.splice(start, end - start);
    }),
  updateMany: (collection, changes) =>
    produce(collection as number[], (draft) => {
      for (const change of changes) {
        draft[change.index] = change.value;
      }
    }),
  snapshot: (collection) => collection,
  iterate: (collection) => collection as number[],
  forEach: (collection, callback) => (collection as number[]).forEach(callback),
};

export const mutativeBrowserAdapter: CollectionAdapter = {
  name: 'mutative',
  description: 'Mutative create with proxy-based immutable updates.',
  create: (values) => values.slice(),
  length: (collection) => (collection as number[]).length,
  get: (collection, index) => (collection as number[])[index],
  set: (collection, index, value) =>
    create(collection as number[], (draft) => {
      draft[index] = value;
    }),
  insert: (collection, index, value) =>
    create(collection as number[], (draft) => {
      draft.splice(index, 0, value);
    }),
  delete: (collection, index) =>
    create(collection as number[], (draft) => {
      draft.splice(index, 1);
    }),
  deleteRange: (collection, start, end) =>
    create(collection as number[], (draft) => {
      draft.splice(start, end - start);
    }),
  updateMany: (collection, changes) =>
    create(collection as number[], (draft) => {
      for (const change of changes) {
        draft[change.index] = change.value;
      }
    }),
  snapshot: (collection) => collection,
  iterate: (collection) => collection as number[],
  forEach: (collection, callback) => (collection as number[]).forEach(callback),
};

export const immutableBrowserAdapter: CollectionAdapter = {
  name: 'immutable-js',
  description: 'Immutable.js List persistent vector.',
  create: (values) => List(values),
  length: (collection) => (collection as ImmutableList<number>).size,
  get: (collection, index) => (collection as ImmutableList<number>).get(index),
  set: (collection, index, value) => (collection as ImmutableList<number>).set(index, value),
  insert: (collection, index, value) => (collection as ImmutableList<number>).insert(index, value),
  delete: (collection, index) => (collection as ImmutableList<number>).delete(index),
  deleteRange: (collection, start, end) => {
    const list = collection as ImmutableList<number>;

    return list.slice(0, start).concat(list.slice(end));
  },
  updateMany: (collection, changes) =>
    (collection as ImmutableList<number>).withMutations((draft) => {
      for (const change of changes) {
        draft.set(change.index, change.value);
      }
    }),
  snapshot: (collection) => collection,
  iterate: (collection) => collection as ImmutableList<number>,
  forEach: (collection, callback) => (collection as ImmutableList<number>).forEach(callback),
};
