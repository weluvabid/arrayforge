export const browserAdapterNames = [
  'native-copy',
  'immer',
  'mutative',
  'immutable-js',
  'bplus-256',
  'rrb-256',
  'bplus-512',
  'rrb-512',
  'bplus-1024',
  'rrb-1024',
] as const;

export const browserAdapterLabels: Readonly<Record<(typeof browserAdapterNames)[number], string>> =
  {
    'native-copy': 'Native Array (copy)',
    immer: 'Immer',
    mutative: 'Mutative',
    'immutable-js': 'Immutable.js',
    'bplus-256': 'ArrayForge B+ 256',
    'rrb-256': 'ArrayForge RRB 256',
    'bplus-512': 'ArrayForge B+ 512',
    'rrb-512': 'ArrayForge RRB 512',
    'bplus-1024': 'ArrayForge B+ 1024',
    'rrb-1024': 'ArrayForge RRB 1024',
  };

export const adapterPrecedence: Readonly<Record<(typeof browserAdapterNames)[number], number>> = {
  'native-copy': 10,
  immer: 30,
  mutative: 40,
  'immutable-js': 50,
  'bplus-256': 100,
  'rrb-256': 101,
  'bplus-512': 102,
  'rrb-512': 103,
  'bplus-1024': 104,
  'rrb-1024': 105,
};
