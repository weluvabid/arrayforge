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
- Deletions remove empty nodes and collapse single-child roots without forcing sibling rebalancing.
- Unchanged subtrees remain shared.

The implementations no longer route through a shared tree class or node representation. `PersistentTreeVector` is the shared public contract; `BPlusVector` and `RrbVector` instantiate separate engines.

## Architecture decision

**RRB is the primary vector implementation.** `Vector.from()` selects RRB. B+ remains available as an alternative for workloads that benefit from stricter occupancy and point-mutation behaviour.

The decision uses the 100K, 1M and 5M benchmark comparison, structural correctness tests and controlled-GC retention profiling. RRB performs particularly well on range deletion and large-dataset reads/iteration. B+ remains competitive on point updates and mixed workloads at some sizes. Across the tested page capacities, RRB offered the stronger overall balance for the target persistent-sequence workload.

The detailed measurements are in [`docs/benchmarks/independent-tree-evaluation.md`](../benchmarks/independent-tree-evaluation.md), with machine-readable results in `docs/benchmarks/results/independent-tree-evaluation-node22.json`.

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
BPlusVector.from(values, { pageCapacity: 512 });
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
- RRB nodes satisfy fanout bounds and relaxed subtree-size metadata.
- Empty subtrees are removed and the root is collapsed where possible.
- Randomized edits are checked against a native-array reference model.
