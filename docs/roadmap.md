# Engineering roadmap

## Phase 0 — Architecture specification

**Status: Complete**

- Freeze the tree evaluation, page sizing, storage interfaces and transaction API.
- Document version ownership, memory behaviour and complexity targets.
- Define benchmark workloads and correctness requirements.

## Phase 1 — Benchmark laboratory

**Status: Complete**

- Add adapters for native arrays, Immer, Mutative and Immutable.js.
- Add repeatable workloads and JSON/CSV reports.
- Add a browser benchmark page for the same workloads.
- Record latency, throughput and memory measurements.

## Phase 2 — Tree evaluation and persistent reference engine

- Implement comparable B+ tree and RRB tree candidates.
- Measure both structures across the benchmark workloads.
- Evaluate reference page capacities and select the primary tree.
- Implement the selected tree and reference pages.
- Add root snapshots, structural sharing and indexed reads.
- Verify point updates and deletion against native arrays.

## Phase 3 — Transaction engine

- Add callback transactions and explicit builders.
- Track page ownership and clone each touched page once.
- Add commit, rollback and no-op detection.

## Phase 4 — Sequence operations

- Implement insertion, deletion, range deletion, splice, slice, concat and move.
- Add efficient traversal and bulk construction.

## Phase 5 — Numeric storage

- Add typed-array pages and numeric operations.
- Measure heap, external and ArrayBuffer memory.

## Phase 6 — Bitsets and sparse storage

- Add packed bit operations, tombstones and compaction.

## Phase 7 — Versioning and browser integration

- Add diffing, patches, history helpers and worker-friendly exports.

## Phase 8 — Optimization

- Tune node layouts, page capacities, allocation paths and browser behaviour from benchmark results.

## Phase 9 — Release

- Publish packages, documentation, examples, benchmark reports and CI performance checks.
