# ArrayForge architecture specification

**Version:** 0.1.0  
**Status:** Initial vector implementation

## Purpose

ArrayForge is a persistent collection library for JavaScript and TypeScript. It targets datasets where an application needs to retain earlier collection versions while applying indexed and sequence updates.

A vector points to an immutable root. An update creates new pages and tree nodes along the affected path, then reuses the unchanged structure.

## Implemented system

The current package consists of:

1. **Public vector API** — indexed reads and writes, insertion, deletion, range deletion, slicing, splicing, concatenation, conversion, snapshots, iteration and transactions.
2. **B+ tree engine** — balanced leaf and branch occupancy, subtree sizes and path copying.
3. **RRB tree engine** — relaxed subtree sizes, cumulative size tables and path copying.
4. **Transaction builder** — pending indexed writes, ordered structural operations, commit and rollback.
5. **Benchmark tooling** — deterministic workloads, Node measurements, V8 allocation sampling and a browser benchmark page.

B+ and RRB have separate node types and algorithms. They implement the same `PersistentTreeVector<T>` contract.

## Tree selection

`Vector.from()` defaults to RRB. The mutation-heavy profile selects B+; balanced, read-heavy and batch-heavy profiles select RRB. The profile also selects the default page capacity.

- **B+ tree:** keeps non-root leaves and branches at or above their minimum occupancy through redistribution or merging.
- **RRB tree:** stores cumulative subtree sizes for relaxed navigation. After deletion, it rebalances underfilled siblings while preserving relaxed size metadata and equal leaf depth.

## Page capacity and branching

Reference pages use a default capacity of 256. The read-heavy profile selects 512 below one million values and 1024 at or above one million values. Callers can also supply a custom `pageSize` and `branchFactor`; both must be safe integers of at least four.

The chosen page capacity and branch factor remain stable for the lifetime of a vector. Conversion can rebuild the vector with different options.

## Storage model

The current implementation uses reference pages containing arbitrary JavaScript values. Branch metadata is represented with ordinary JavaScript arrays and scalar fields.

Typed-array numeric pages, bit-packed pages, sparse/tombstone storage and worker-owned storage are not implemented in this release. They should not be described as current backends or public capabilities.

## Version and ownership rules

- Every committed version has an immutable root.
- Published nodes and pages are not mutated.
- Unchanged subtrees remain shared between versions.
- A no-op point update can return the existing vector.
- Earlier snapshots remain readable after later updates.
- JavaScript garbage collection reclaims unreachable roots, nodes and pages.

Reference pages preserve the identity and mutability of stored values. ArrayForge guarantees structural immutability, not deep immutability of user data.

## Transactions

Transactions are synchronous. A builder stages point writes in a map and flushes them through `setMany()` before structural operations or commit. This preserves operation order while grouping pending point updates. A callback exception or thenable return rolls back the builder and leaves the original vector unchanged.

## Implemented sequence operations

The public contract includes indexed reads and updates, insertion, point deletion, half-open range deletion, `slice`, `splice`, `concat`, conversion between tree types, iteration, callback visitation, snapshots, builders and callback transactions.

## Complexity goals

| Operation            | Expected cost                                                    |
| -------------------- | ---------------------------------------------------------------- |
| Snapshot             | O(1)                                                             |
| Indexed lookup       | O(log N) tree navigation, plus page-local access                 |
| Point update         | O(log N + page copy)                                             |
| Insert/delete        | O(log N + page copy), plus local balancing                       |
| Sequential traversal | O(N)                                                             |
| Batch point writes   | Shared traversal of affected paths and one copy per touched page |

The exact constants depend on page capacity, branch factor, tree shape and workload.

## Benchmark scope

The checked-in scale run covers 100K, 1M, 5M and 10M values. The benchmark tooling also supports independent workload runs and allocation/retention profiling.

## Runtime

The package is implemented in TypeScript and targets Node.js 26 or newer. The browser benchmark is built with Vite. WebAssembly and worker-based execution are not part of the current package.
