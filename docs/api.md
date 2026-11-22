# API reference

ArrayForge exposes immutable vectors backed by either a B+ tree or an RRB tree. Both implementations share the `PersistentTreeVector<T>` interface.

## Constants

### `PROFILE`

| Constant                 | Value            | Intended workload                      |
| ------------------------ | ---------------- | -------------------------------------- |
| `PROFILE.BALANCED`       | `balanced`       | General-purpose use; default profile   |
| `PROFILE.READ_HEAVY`     | `read-heavy`     | Frequent indexed reads                 |
| `PROFILE.MUTATION_HEAVY` | `mutation-heavy` | Frequent point updates and deletes     |
| `PROFILE.BATCH_HEAVY`    | `batch-heavy`    | Groups of updates and range operations |

### `TREE`

| Constant      | Value   | Meaning                          |
| ------------- | ------- | -------------------------------- |
| `TREE.AUTO`   | `auto`  | Select from the workload profile |
| `TREE.B_PLUS` | `bplus` | Use the B+ tree                  |
| `TREE.RRB`    | `rrb`   | Use the RRB tree                 |

### `PAGE_SIZE`

| Constant           | Value |
| ------------------ | ----- |
| `PAGE_SIZE.SMALL`  | 256   |
| `PAGE_SIZE.MEDIUM` | 512   |
| `PAGE_SIZE.LARGE`  | 1024  |

Custom page sizes are supported. A page size and branch factor must each be safe integers greater than or equal to four.

## Construction

### `Vector.from(values, options?)`

Creates a vector using automatic tree selection. The default profile is `PROFILE.BALANCED`.

```ts
import { PROFILE, TREE, Vector } from 'arrayforge';

const general = Vector.from(values);
const batch = Vector.from(values, { profile: PROFILE.BATCH_HEAVY });
const explicit = Vector.from(values, { tree: TREE.RRB });
```

Automatic selection uses these defaults:

| Profile          | Tree | Page size                                                 |
| ---------------- | ---- | --------------------------------------------------------- |
| `BALANCED`       | RRB  | 256                                                       |
| `READ_HEAVY`     | RRB  | 512 below one million items; 1024 at or above one million |
| `MUTATION_HEAVY` | B+   | 256                                                       |
| `BATCH_HEAVY`    | RRB  | 256                                                       |

When `tree` is explicitly set to `TREE.B_PLUS` or `TREE.RRB`, that selection takes precedence over the profile.

### `BPlusVector.from(values, options?)`

Creates a B+ vector regardless of the profile.

### `RRBVector.from(values, options?)`

Creates an RRB vector regardless of the profile. `RrbVector` is also exported as a spelling-compatible alias.

### Construction options

```ts
interface TreeOptions {
  profile?: PageProfile;
  pageSize?: number;
  branchFactor?: number;
}

interface VectorOptions extends TreeOptions {
  tree?: TreeSelection;
}
```

`Vector.from()` defaults to RRB, in accordance with ADR-008. The mutation-heavy profile selects B+; other automatic profiles select RRB. The concrete `BPlusVector.from()` and `RRBVector.from()` constructors accept `TreeOptions` and always create their named implementation. `branchFactor` defaults to 32.

When `pageSize` is omitted, ArrayForge selects a page size from the profile and collection length. The collection exposes its selected value through `pageSize`.

## Collection operations

All operations return a new collection when they change its contents. The source collection remains available.

| Method                                 | Behaviour                                                   |
| -------------------------------------- | ----------------------------------------------------------- |
| `get(index)`                           | Read an item by index                                       |
| `set(index, value)`                    | Replace an item at an index                                 |
| `setMany(changes)`                     | Apply indexed writes together                               |
| `insert(index, value)`                 | Insert an item at an index                                  |
| `delete(index)`                        | Remove one item                                             |
| `deleteRange(start, end)`              | Remove the half-open range `[start, end)`                   |
| `slice(start?, end?)`                  | Return a vector containing the selected range               |
| `splice(start, deleteCount, ...items)` | Return a vector with a range replaced by the supplied items |
| `concat(other)`                        | Append an iterable of items                                 |
| `snapshot()`                           | Return the current immutable version                        |
| `toArray()`                            | Copy the collection into a JavaScript array                 |
| `forEach(callback)`                    | Visit values and indexes without creating iterator results  |
| `assertValid()`                        | Check the tree's structural invariants                      |

`setMany()` accepts an array of `{ index, value }` changes or a `Map<number, T>`. Duplicate array indexes use last-write-wins semantics; a `Map` can be passed directly when writes are already deduplicated. Indexes for `get`, `set`, `insert`, `delete` and `deleteRange` are validated and invalid indexes throw `RangeError`. `slice` and `splice` use JavaScript-style negative-index and boundary normalization.

`splice` returns the updated vector. It does not return the removed items or modify the source vector.

## Conversion

Use `convertTo()` when the destination is selected at runtime, or use the dedicated methods when it is known in advance.

```ts
import { TREE } from 'arrayforge';

const rrb = vector.convertTo(TREE.RRB);
const bplus = rrb.toBPlus();
```

Conversion walks the source iterator and builds destination pages directly. It does not create a full intermediate JavaScript array. The operation takes O(n) time and allocates the destination tree. The source and its snapshots remain unchanged.

Conversion options accept `pageSize`, `profile`, and `branchFactor`. TypeScript infers the concrete destination type from `TREE.B_PLUS` or `TREE.RRB`.

## Workload profiles

`withProfile(profile)` returns a collection configured for the requested workload, rebuilding it when the selected tree or page size changes:

```ts
import { PROFILE } from 'arrayforge';

const batchOptimized = vector.withProfile(PROFILE.BATCH_HEAVY);
const readOptimized = batchOptimized.withProfile(PROFILE.READ_HEAVY);
```

The mutation-heavy profile selects B+. Balanced, read-heavy and batch-heavy profiles select RRB. The profile also selects the default page size. Use `convertTo()` when you want to choose the tree directly without applying a workload profile.

## Transactions

### `transact(callback)`

Runs a synchronous group of writes and structural operations. The callback receives a mutable draft; the committed result is a new immutable vector.

```ts
const next = vector.transact((draft) => {
  draft.set(4, first);
  draft.insert(8, second);
  draft.delete(12);
});
```

If the callback throws, the transaction is rolled back and the error is rethrown. Returning a promise is rejected because transactions are synchronous.

### `builder()`

Creates an explicit `VectorBuilder<T>`. Call `set`, `insert`, `delete`, or `deleteRange`, then call `commit()` to produce the immutable result. Call `rollback()` to discard pending changes.

A builder can be committed or rolled back only once. Operations after it is closed throw an error.

## Iteration

Vectors implement `Iterable<T>` and return independent `IterableIterator<T>` instances. `forEach()` traverses tree leaves directly and avoids allocating an iterator-result object for every value; use it for allocation-sensitive full scans.

```ts
for (const item of vector) {
  consume(item);
}

vector.forEach((item, index) => {
  consume(item, index);
});

const iterator = vector[Symbol.iterator]();
const first = iterator.next();
```

## Types

The package exports `PersistentTreeVector<T>`, `BPlusVector<T>`, `RRBVector<T>`, `Vector<T>`, `TreeOptions`, `TreeKind`, `TreeSelection`, `Profile`, `PageProfile`, `PageSize`, and `VectorDraft<T>`.
