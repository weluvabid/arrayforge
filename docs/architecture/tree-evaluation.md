# Tree evaluation

ArrayForge has two persistent sequence candidates: a balanced B+ tree and an RRB-style relaxed tree.

Both use immutable reference pages, subtree-size metadata and path copying. The benchmark adapters expose the same operations and page capacities so the candidates can be compared with the same workloads.

## Candidate differences

### B+ tree

- Leaves hold reference pages.
- Internal nodes store cumulative subtree sizes.
- Leaf and internal occupancy is rebalanced after point deletion and range deletion.
- Splits keep sibling occupancy balanced.

### RRB-style tree

- Leaves hold reference pages.
- Internal nodes store cumulative subtree sizes for indexed navigation.
- Insertions split full pages and branches.
- Deletions remove empty branches while retaining relaxed occupancy.
- Existing subtrees remain shared.

The B+ tree keeps pages more evenly occupied after repeated deletion. The RRB-style tree does less work during deletion and range deletion.

## Current API default

`Vector` currently maps to the RRB-style candidate. `BPlusVector` remains available through the same collection interface.

This default does not close the architecture decision. The initial benchmark results show workload-specific trade-offs, so both candidates remain available until mixed-operation, iteration and memory-retention measurements are complete.

The current branch factor is 32. Page capacity is selected when a vector is created.

## Page sizing

ArrayForge supports three page capacities:

| Capacity | Typical use                                      |
| -------: | ------------------------------------------------ |
|      256 | Smaller collections and mutation-heavy workloads |
|      512 | Balanced workloads                               |
|     1024 | Large, read-heavy collections                    |

`Vector.from()` uses the balanced profile by default.

```ts
Vector.from(values, { profile: 'mutation-heavy' });
Vector.from(values, { profile: 'balanced' });
Vector.from(values, { profile: 'read-heavy' });
```

The policy selects a page capacity from the initial collection length and the selected profile. The chosen capacity remains stable for that vector's lifetime.

## Complexity

For a tree with branching factor B and page capacity P:

| Operation    | Expected cost                                          |
| ------------ | ------------------------------------------------------ |
| Snapshot     | O(1)                                                   |
| Indexed read | O(log_B N)                                             |
| Point update | O(log_B N + P)                                         |
| Insert       | O(log_B N + P)                                         |
| Point delete | O(log_B N + P)                                         |
| Range delete | Visits affected boundary paths and retained tree nodes |
| Iteration    | O(N)                                                   |

Page cloning copies at most one reference page along the modified path for a point update. Unchanged pages and branches are shared between versions.
