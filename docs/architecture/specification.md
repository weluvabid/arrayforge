# ArrayForge architecture specification

**Version:** 0.1.0  
**Status:** Foundational decisions frozen

## Purpose

ArrayForge is a persistent collection engine for JavaScript and TypeScript. It is designed for large browser-resident datasets that need frequent updates, snapshots and history.

A collection version points to an immutable root. An update creates new pages and tree paths where needed, then reuses the rest of the existing structure.

## System layers

1. **Public API** — vectors, numeric collections, snapshots, sequence operations and transactions.
2. **Persistent tree** — indexed navigation, subtree sizes, structural sharing and rebalancing.
3. **Storage backends** — reference pages, typed numeric pages and packed metadata.
4. **Transaction engine** — page ownership, copy-on-write, commit and rollback.
5. **Runtime support** — iteration, memory measurements and browser integration.

The public collection interfaces stay independent of the tree and page implementations.

## Tree selection

ArrayForge evaluates two persistent sequence structures:

- **B+ tree:** balanced leaf and branch occupancy with subtree-size metadata.
- **RRB-style tree:** relaxed occupancy with subtree-size metadata and path copying.

The independent evaluation selected RRB as the primary sequence engine. B+ remains available as a separately implemented alternative. `Vector` defaults to RRB.

The completed comparison covers indexed reads, updates, insertions, deletions, range deletion, batch updates, mixed operations and sequential iteration at 100K, 1M and 5M elements. Controlled-GC profiling measures sampled allocations and retained snapshot memory.

## Page capacity

Reference pages use bounded capacities of 256, 512 and 1024 elements.

The balanced and mutation-heavy profiles select 256-element pages. The read-heavy profile selects 512-element pages below 1M elements and 1024-element pages from 1M upward.

The selected capacity remains stable for the lifetime of a vector. Splits, rebalancing and relaxed-node edits preserve earlier snapshots.

## Storage backends

Reference and numeric collections share collection-level interfaces while retaining specialized page implementations.

- **Reference pages:** arbitrary JavaScript values and object references.
- **Numeric pages:** typed arrays for integer and floating-point data.
- **Bit-packed pages:** flags, validity masks and compact boolean data.
- **Sparse metadata:** tombstones and deferred compaction.

Numeric pages must preserve the selected typed-array representation and its conversion semantics.

## Version and ownership rules

- Every committed version has an immutable root.
- Published nodes and pages never mutate.
- Unchanged subtrees remain shared.
- A no-op update reuses the original root.
- Earlier snapshots remain readable after later commits.
- JavaScript garbage collection manages unreachable roots, nodes and pages.

Reference pages preserve the identity of stored values. Collection immutability applies to ArrayForge's storage structure.

## Transactions

Both transaction styles are part of the public design:

```ts
const next = vector.transact((draft) => {
  draft.set(100, valueA);
  draft.set(200, valueB);
});
```

```ts
const builder = vector.builder();
builder.set(100, valueA);
builder.set(200, valueB);
const next = builder.commit();
```

Pending point writes are grouped by subtree range and committed through `setMany()`. Each touched leaf and each affected ancestor is copied once per batch. Structural operations flush pending writes first, preserving operation order.

A commit publishes one new root. If the callback throws, the original version remains unchanged.

Initial transactions are synchronous. Worker communication uses explicit data boundaries.

## Sequence operations

The collection API will cover indexed reads and updates, insertion, deletion, range deletion, splice, slice, concatenation, move, mapping, filtering and iteration.

Sequence ranges use a half-open interval: start inclusive, end exclusive. Ordered deletion updates subtree sizes and rebalances affected nodes without shifting the remaining collection.

Logical deletion through tombstones is a separate operation from ordered deletion. Physical and logical indexes remain distinct.

## Performance targets

| Operation            | Target complexity                         |
| -------------------- | ----------------------------------------- |
| Snapshot             | O(1)                                      |
| Indexed lookup       | O(log N)                                  |
| Point update         | O(log N + page copy)                      |
| Point deletion       | O(log N + page copy)                      |
| Sequential iteration | O(N)                                      |
| Batch mutation       | Reuse each touched page and modified path |

The benchmark suite covers 100K, 1M, 5M, 10M and 50M elements. Results include latency percentiles, throughput, heap, external memory, ArrayBuffer memory, RSS and checksums. The independent tree evaluation is recorded in `docs/benchmarks/independent-tree-evaluation.md`.

## Runtime

The initial implementation uses TypeScript. WebAssembly can be added to measured numeric or bulk-operation hot paths later, while keeping the JavaScript API and persistent version model stable.
