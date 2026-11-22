import type { CollectionAdapter } from '../benchmark/types.ts';

interface MutativeModule {
  readonly create: <T>(base: T, recipe: (draft: T) => void) => T;
}

export async function loadMutativeAdapter(): Promise<CollectionAdapter> {
  const moduleName = 'mutative';
  const loaded = (await import(moduleName)) as MutativeModule;
  const create = loaded.create;

  return {
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
  };
}
