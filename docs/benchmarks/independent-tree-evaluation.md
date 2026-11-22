# Independent B+ and RRB evaluation

- **Evaluation date:** 2026-11-22
- **Runtime:** Node.js 22.16.0, Linux x64
- **Datasets:** 100K, 1M and 5M values
- **Measured rounds:** 7, after 2 warm-up rounds
- **Target sample:** 25ms
- **Reference page capacities:** 256, 512 and 1024
- **Branch factor:** 32

## Scope

This is the historical pre-correction benchmark baseline. The Node benchmark harness has since been corrected to move workload setup outside timed sections and to apply delete sequences consistently across adapters. Rerun the full evaluation before treating these figures as current release acceptance results.

This evaluation compares separate B+ and RRB engines. Each implementation has its own node representation, build process, indexed navigation, update/insert/delete algorithms, range deletion and iterator. Both expose the same collection contract and preserve immutable roots.

The benchmark covered point reads, point updates, inserts, deletes, batch updates, range deletion, sequential iteration and mixed operations. The primary JSON result contains every adapter/workload/dataset result and the actual sample duration. Some capped workloads completed below the 25ms target; actual durations are recorded per result. Point and range deletion were also run separately against an unchanged base collection, with calibrated samples; those results are in `independent-tree-deletions-node22.json` and supply the deletion rows below.

## Decision summary

RRB is the primary structure. The 256-element page is the balanced default. The 512 and 1024 variants remain useful tuning options, with 1024 reserved for large read-heavy workloads.

The workload split is meaningful:

- RRB is consistently strong in range deletion and large-dataset read workloads.
- B+ is competitive or faster for point updates and some mixed workloads.
- Sequential iteration is close at 100K and 1M; at 5M the RRB 256 result was about 50.86ms versus 59.03ms for B+ 256 in this run.
- Neither tree dominates every individual workload. RRB provides the stronger aggregate fit for the intended persistent sequence engine.

## 256-page comparison

Values below are p50 milliseconds per workload iteration. A batch-update iteration applies the full 1,000-change batch; an iteration workload traverses the complete collection. Throughput is iterations per second. Results are from the same benchmark runtime.

| Dataset | Workload     |   B+ p50 |  RRB p50 | Higher throughput |
| ------: | ------------ | -------: | -------: | ----------------- |
|    100K | Point read   |  0.00009 |  0.00008 | RRB               |
|    100K | Point update |  0.00080 |  0.00095 | B+                |
|    100K | Insert       |  0.00067 |  0.00068 | B+ (marginal)     |
|    100K | Delete       |  0.00070 |  0.00059 | RRB               |
|    100K | Range delete |  0.00472 |  0.00196 | RRB               |
|    100K | Batch update |  0.03874 |  0.03678 | RRB               |
|    100K | Iteration    |  0.59089 |  0.94710 | B+                |
|    100K | Mixed        |  0.00053 |  0.00054 | B+ (marginal)     |
|      1M | Point read   |  0.00013 |  0.00013 | Similar           |
|      1M | Point update |  0.00143 |  0.00152 | B+                |
|      1M | Insert       |  0.00069 |  0.00063 | RRB               |
|      1M | Delete       |  0.00061 |  0.00083 | B+                |
|      1M | Range delete |  0.01577 |  0.00238 | RRB               |
|      1M | Batch update |  0.05394 |  0.05584 | B+ (marginal)     |
|      1M | Iteration    |  9.67809 |  9.83657 | Similar           |
|      1M | Mixed        |  0.00137 |  0.00068 | RRB               |
|      5M | Point read   |  0.00035 |  0.00028 | RRB               |
|      5M | Point update |  0.00221 |  0.00270 | B+                |
|      5M | Insert       |  0.00231 |  0.00257 | B+                |
|      5M | Delete       |  0.00076 |  0.00075 | Similar           |
|      5M | Range delete |  0.00506 |  0.00346 | RRB               |
|      5M | Batch update |  0.08158 |  0.07134 | RRB               |
|      5M | Iteration    | 59.03059 | 50.85731 | RRB               |
|      5M | Mixed        |  0.00106 |  0.00118 | B+                |

## Memory and allocation profile

The profiling run used explicit garbage collection, 20,000 point updates and 64 retained snapshots. Heap allocation figures are sampled through the V8 allocation profiler; they are not exact total allocation counters.

| Dataset | Engine | Update time | Sampled update allocation | Retained heap delta for 64 snapshots |
| ------: | ------ | ----------: | ------------------------: | -----------------------------------: |
|      1M | B+     |     45.98ms |                    7.53MB |                                237KB |
|      1M | RRB    |     49.12ms |                    7.65MB |                                254KB |
|      5M | B+     |     89.54ms |                   34.57MB |                                253KB |
|      5M | RRB    |     82.13ms |                   34.54MB |                                275KB |

Both engines retained a small, similar amount of additional heap for the 64 snapshots. Releasing the snapshot references and collecting garbage returned heap usage close to baseline. External and ArrayBuffer deltas were effectively zero for these reference-page workloads.

## Transaction write ownership

`setMany()` sorts pending writes by index, routes each contiguous update range down the tree and clones each affected leaf once. Ancestors on touched paths are rebuilt once. `VectorBuilder` accumulates point writes until a structural operation or commit, then flushes them as one batch.

The transaction profiler compares 20,000 deterministic writes, using five measured rounds after two warm-ups. The median results were:

| Dataset | Engine | Repeated `set()` | Transaction | Speedup |
| ------: | ------ | ---------------: | ----------: | ------: |
|      1M | B+     |          22.81ms |     14.82ms |   1.54× |
|      1M | RRB    |          22.09ms |     16.38ms |   1.35× |
|      5M | B+     |          34.44ms |     33.73ms |   1.02× |
|      5M | RRB    |          36.18ms |     29.95ms |   1.21× |

The transaction tests verify source-version preservation, mixed write/insert/delete ordering, commit behaviour and callback rollback for both engines.

## Correctness

The test suite runs deterministic randomized edits against native arrays for both structures and calls `assertValid()` after every randomized operation. Structural checks cover:

- B+ leaf/branch occupancy, equal child heights and cumulative subtree sizes.
- RRB fanout bounds, equal child levels and relaxed size-table metadata.
- Empty collections, root collapse, boundary inserts/deletes and large range deletion.
- Independent iterators, early termination and immutable snapshot preservation.

## Interpretation

The conclusion is the architecture split: RRB becomes the default for the target workload; B+ remains a first-class alternative for mutation-heavy access patterns. Page capacity 256 is the balanced default, while read-heavy workloads can opt into 512 or 1024.
