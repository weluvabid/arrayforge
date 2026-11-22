# ArrayForge

Persistent vectors for large JavaScript and TypeScript datasets.

ArrayForge keeps earlier versions of a collection available while you create updated ones. A point update copies the affected page and the tree nodes along its path. Unchanged parts of the structure are shared between versions, so creating a snapshot is constant-time.

## Install

```sh
pnpm add @arrayforge/core
```

## Quick start

```ts
import { Vector } from '@arrayforge/core';

const users = Vector.from([
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Grace' },
]);

const nextUsers = users.set(1, { id: 2, name: 'Grace Hopper' });

console.log(users.get(1)?.name); // Grace
console.log(nextUsers.get(1)?.name); // Grace Hopper
```

`users` stays unchanged. Both versions share the parts of the tree that the update did not touch.

## Choose a tree

`Vector.from()` uses the RRB engine by default. The mutation-heavy profile selects B+; the other profiles select RRB.

```ts
import { PROFILE, Vector } from '@arrayforge/core';

const general = Vector.from(data);
const batchWork = Vector.from(data, { profile: PROFILE.BATCH_HEAVY });
const readWork = Vector.from(data, { profile: PROFILE.READ_HEAVY });
const mutationWork = Vector.from(data, { profile: PROFILE.MUTATION_HEAVY });
```

You can also choose an implementation directly:

```ts
import { BPlusVector, RRBVector } from '@arrayforge/core';

const indexedEdits = BPlusVector.from(data);
const sequenceWork = RRBVector.from(data);
```

Both engines expose the same collection operations. RRB is the default; B+ remains available when its stricter occupancy policy suits the workload better.

## Change the implementation later

A collection can be rebuilt into the other tree without first converting the whole collection into a JavaScript array.

```ts
import { TREE } from '@arrayforge/core';

const rrb = general.convertTo(TREE.RRB);
const bplus = rrb.toBPlus();
```

`toRRB()` and `toBPlus()` are the dedicated alternatives. The original collection and its snapshots remain unchanged.

## Work with immutable versions

```ts
const updated = general.set(10, replacement).insert(20, newItem).deleteRange(40, 50);

const window = updated.slice(10, 30);
const expanded = updated.concat(otherItems);
const replaced = updated.splice(5, 2, first, second);
```

For a group of related writes, use a transaction:

```ts
const next = general.transact((draft) => {
  draft.set(10, replacement);
  draft.set(20, anotherReplacement);
  draft.insert(30, newItem);
});
```

Transactions are synchronous. If the callback throws, the original collection remains unchanged.

## Page sizes

Use the exported constants for the built-in page sizes:

```ts
import { PAGE_SIZE, TREE, Vector } from '@arrayforge/core';

const compact = Vector.from(data, {
  tree: TREE.B_PLUS,
  pageSize: PAGE_SIZE.SMALL,
});
```

The built-in sizes are `PAGE_SIZE.SMALL` (256), `PAGE_SIZE.MEDIUM` (512), and `PAGE_SIZE.LARGE` (1024). Custom page sizes are also accepted when they are safe integers of at least four.

## Performance

The checked-in Node benchmark runs cover 100K, 1M, 5M and 10M elements. They show where the two trees trade places rather than one implementation winning every workload. The results and the measurement limits are described in the [performance notes](docs/performance.md).

## Documentation

- [API reference](docs/api.md)
- [Architecture overview](docs/architecture/overview.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Performance notes](docs/performance.md)
- [Benchmarking guide](docs/benchmarking.md)

ArrayForge is released under the MIT license.
