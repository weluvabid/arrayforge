# Architecture overview

ArrayForge separates the collection API from the structures that store its data.

## Main layers

1. **Collection API** — indexed access, sequence operations, snapshots and transactions.
2. **Persistent tree** — independent B+ and RRB engines with separate node invariants, subtree-size metadata and path-copying algorithms.
3. **Storage backends** — reference pages, numeric pages and packed metadata.
4. **Transaction engine** — tracks writable pages and publishes a new root on commit.
5. **Runtime support** — iteration, allocation diagnostics and browser integration.

## Published versions

A committed collection points to an immutable root. Updates create new paths and pages while reusing unchanged subtrees. Earlier versions continue to read from their original roots.

The collection guarantees structural immutability of its storage. Values stored in reference pages keep their normal JavaScript identity and mutability.

## Storage backends

Reference pages store arbitrary JavaScript values. Numeric pages use typed arrays. Bit-packed pages store flags and validity masks. The backends share collection-level contracts while keeping their physical representations specialized.

## Transactions

A transaction stages point writes and applies them through a sorted `setMany()` traversal. Each touched leaf and affected ancestor is copied once per batch. Structural operations flush pending writes first so operation order is preserved. Commit publishes one new root; an exception leaves the original collection unchanged. Transactions are synchronous.

Both callback transactions (`transact()`) and explicit builder/commit workflows (`builder()`) are implemented.
