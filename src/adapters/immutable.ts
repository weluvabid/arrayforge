import type { CollectionAdapter } from '../benchmark/types.ts';

interface ImmutableList {
  readonly size: number;
  get(index: number): number | undefined;
  set(index: number, value: number): ImmutableList;
  insert(index: number, value: number): ImmutableList;
  delete(index: number): ImmutableList;
  slice(start?: number, end?: number): ImmutableList;
  concat(other: ImmutableList): ImmutableList;
  withMutations(callback: (list: MutableImmutableList) => void): ImmutableList;
  [Symbol.iterator](): Iterator<number>;
}

interface MutableImmutableList {
  set(index: number, value: number): MutableImmutableList;
}

interface ImmutableModule {
  readonly List: (values: number[]) => ImmutableList;
}

export async function loadImmutableAdapter(): Promise<CollectionAdapter> {
  const moduleName = 'immutable';
  const loaded = (await import(moduleName)) as ImmutableModule;
  const List = loaded.List;

  return {
    name: 'immutable-js',
    description: 'Immutable.js List persistent vector.',
    create: (values) => List(values),
    length: (collection) => (collection as ImmutableList).size,
    get: (collection, index) => (collection as ImmutableList).get(index),
    set: (collection, index, value) => (collection as ImmutableList).set(index, value),
    insert: (collection, index, value) => (collection as ImmutableList).insert(index, value),
    delete: (collection, index) => (collection as ImmutableList).delete(index),
    deleteRange: (collection, start, end) => {
      const list = collection as ImmutableList;

      return list.slice(0, start).concat(list.slice(end)) as ImmutableList;
    },
    updateMany: (collection, changes) =>
      (collection as ImmutableList).withMutations((draft) => {
        for (const change of changes) {
          draft.set(change.index, change.value);
        }
      }),
    snapshot: (collection) => collection,
    iterate: (collection) => collection as ImmutableList,
  };
}
