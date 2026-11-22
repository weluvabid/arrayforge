import { nativeCopyAdapter, nativeMutableAdapter } from '../adapters/native.ts';
import { persistentTreeAdapters } from '../adapters/persistent-tree.ts';
import { loadImmerAdapter } from '../adapters/immer.ts';
import { loadImmutableAdapter } from '../adapters/immutable.ts';
import { loadMutativeAdapter } from '../adapters/mutative.ts';
import type { AdapterLoadResult, CollectionAdapter } from './types.ts';

const optionalAdapters: ReadonlyArray<readonly [string, () => Promise<CollectionAdapter>]> = [
  ['immer', loadImmerAdapter],
  ['mutative', loadMutativeAdapter],
  ['immutable-js', loadImmutableAdapter],
];

export async function loadAdapters(
  requested: readonly string[] = ['all'],
): Promise<AdapterLoadResult[]> {
  const includeAll = requested.includes('all');
  const knownNames = new Set([
    'all',
    nativeCopyAdapter.name,
    nativeMutableAdapter.name,
    ...optionalAdapters.map(([name]) => name),
    ...persistentTreeAdapters.map((adapter) => adapter.name),
  ]);
  const unknownNames = requested.filter((name) => !knownNames.has(name));

  if (unknownNames.length > 0) {
    throw new Error(`Unknown adapter: ${unknownNames.join(', ')}`);
  }

  const selected = new Set(requested);
  const results: AdapterLoadResult[] = [];

  if (includeAll || selected.has(nativeCopyAdapter.name)) {
    results.push({ adapter: nativeCopyAdapter });
  }

  if (includeAll || selected.has(nativeMutableAdapter.name)) {
    results.push({ adapter: nativeMutableAdapter });
  }

  for (const adapter of persistentTreeAdapters) {
    if (includeAll || selected.has(adapter.name)) {
      results.push({ adapter });
    }
  }

  for (const [name, load] of optionalAdapters) {
    if (!includeAll && !selected.has(name)) {
      continue;
    }

    try {
      results.push({ adapter: await load() });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({ adapter: null, reason: `${name}: ${reason}` });
    }
  }

  return results;
}
