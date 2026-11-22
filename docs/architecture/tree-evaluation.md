# Tree evaluation and architecture decision

- **Status:** Complete
- **Primary structure:** RRB tree
- **Default reference page:** 256 elements

ArrayForge now contains two independent persistent sequence implementations. They have separate node representations, construction paths, indexed navigation, mutation algorithms, deletion policies, iterators and structural validators.

## Candidate implementations

### B+ tree

- Leaves hold bounded reference pages.
- Internal nodes store cumulative subtree sizes.
- Leaf and branch occupancy is kept at or above half capacity outside the root.
- Point deletion and range deletion rebalance underfull siblings through redistribution or merging.
- Splits preserve balanced occupancy.

### RRB tree

- Leaves hold bounded reference pages.
- Internal nodes store cumulative subtree-size tables for relaxed indexed navigation.
- Branches may have relaxed occupancy while all leaves remain at the same depth.
- Insertions split overflowing pages and branches along the affected path.
- Point and range deletions rebalance underfilled adjacent siblings by redistribution or merging, while retaining relaxed subtree-size metadata.
- Single-child roots are collapsed after deletion.
- Unchanged subtrees remain shared.

The implementations no longer route through a shared tree class or node representation. `PersistentTreeVector` is the shared public contract; `BPlusVector` and `RrbVector` instantiate separate engines.

## Architecture decision

**RRB is the primary vector implementation.** `Vector.from()` selects RRB. B+ remains available as an alternative for workloads that benefit from stricter occupancy and point-mutation behaviour.

The default decision combines the earlier 100K, 1M and 5M comparison with structural correctness and retention profiling. Later scale runs extend to 10M and show that the workload split is real: RRB is often strong on reads, insertions and callback traversal, while B+ can lead on point updates, deletes, batches or range deletion. Neither engine wins every workload; RRB remains the general default and B+ is available for workloads that favour its balancing policy.

The earlier independent comparison is retained in [`docs/benchmarks/independent-tree-evaluation.md`](../benchmarks/independent-tree-evaluation.md). The later navigation, churn, allocation and scale measurements are summarized in [`docs/performance.md`](../performance.md), with their raw results under `docs/benchmarks/results/`.

## Page sizing

ArrayForge supports 256, 512 and 1024 element reference pages.

| Profile          | Selection                           | Intended workload                                  |
| ---------------- | ----------------------------------- | -------------------------------------------------- |
| `balanced`       | 256                                 | General persistent collections and mixed workloads |
| `mutation-heavy` | 256                                 | Frequent point edits and sequence changes          |
| `read-heavy`     | 512 below 1M elements; 1024 from 1M | Large indexed-read workloads                       |

The capacity is selected at construction and remains stable for the vector's lifetime. 512 and 1024 remain explicit tuning choices rather than the general default.

```ts
Vector.from(values);
Vector.from(values, { profile: 'mutation-heavy' });
Vector.from(values, { profile: 'read-heavy' });
BPlusVector.from(values, { pageSize: 512 });
```

## Complexity

For branching factor B and page capacity P:

| Operation             | Expected cost                                 |
| --------------------- | --------------------------------------------- |
| Snapshot              | O(1)                                          |
| Indexed read          | O(log_B N)                                    |
| Point update          | O(log_B N + P)                                |
| Insert                | O(log_B N + P)                                |
| Point delete          | O(log_B N + P)                                |
| Range delete          | O(visited boundary paths + affected metadata) |
| Iteration             | O(N)                                          |
| Batched point updates | O(U log_B N + touched pages × P)              |

`setMany()` sorts and groups updates by subtree range. Each touched leaf is copied once per batch, and each affected ancestor is rebuilt once. Unchanged pages and branches remain shared.

## Transactions

Both callback transactions and explicit builders are implemented:

```ts
const next = vector.transact((draft) => {
  draft.set(100, valueA);
  draft.set(200, valueB);
  draft.insert(300, valueC);
});

const draft = vector.builder();
draft.set(100, valueA);
draft.set(200, valueB);
const committed = draft.commit();
```

Pending point writes are grouped and committed through `setMany()`. Structural operations flush pending writes first, preserving call order. A callback exception leaves the source vector unchanged. Async callbacks are rejected because transaction scopes are synchronous. Builder rollback discards the unpublished working version.

## Invariants

Both engines expose `assertValid()` for structural verification.

- Every branch's cumulative size table exactly matches its children.
- All children of a branch have the same height/level.
- No published node or page is mutated.
- B+ non-root leaves and branches satisfy minimum occupancy.
- RRB nodes satisfy fanout bounds, equal leaf depth and relaxed subtree-size metadata.
- Empty subtrees are removed and the root is collapsed where possible.
- Randomized edits are checked against a native-array reference model.
