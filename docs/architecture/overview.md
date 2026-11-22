# Architecture overview

ArrayForge separates the collection API from the structures that store its data.

## Main layers

1. **Collection API** — indexed access, sequence operations, snapshots and transactions.
2. **Persistent tree** — navigation, subtree sizes, structural sharing and path copying.
3. **Storage backends** — reference pages, numeric pages and packed metadata.
4. **Transaction engine** — tracks writable pages and publishes a new root on commit.
5. **Runtime support** — iteration, allocation diagnostics and browser integration.

## Published versions

A committed collection points to an immutable root. Updates create new paths and pages while reusing unchanged subtrees. Earlier versions continue to read from their original roots.

The collection guarantees structural immutability of its storage. Values stored in reference pages keep their normal JavaScript identity and mutability.

## Storage backends

Reference pages store arbitrary JavaScript values. Numeric pages use typed arrays. Bit-packed pages store flags and validity masks. The backends share collection-level contracts while keeping their physical representations specialized.

## Transactions

A transaction owns the pages it changes. The first write to a shared page creates a private copy. Later writes in the same transaction reuse that copy. Commit publishes a new root; an exception leaves the original collection unchanged.

Both callback transactions and explicit builder/commit workflows are part of the planned API.
