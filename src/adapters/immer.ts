import type { CollectionAdapter } from '../benchmark/types.ts';

interface ImmerModule {
  readonly produce: <T>(base: T, recipe: (draft: T) => void) => T;
}

export async function loadImmerAdapter(): Promise<CollectionAdapter> {
  const moduleName = 'immer';
  const loaded = (await import(moduleName)) as ImmerModule;
  const produce = loaded.produce;

  return {
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
}
