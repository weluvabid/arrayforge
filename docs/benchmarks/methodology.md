# Benchmark methodology

The benchmark lab provides a consistent set of workloads for comparing collection strategies.

## Adapters

- `native-copy` — native arrays with a full copy for immutable updates.
- `native-mutable` — native arrays updated in place as a mutable throughput reference.
- `immer` — Immer `produce`.
- `mutative` — Mutative `create`.
- `immutable-js` — Immutable.js `List`.

## Workloads

| Workload               | Operation                                           |
| ---------------------- | --------------------------------------------------- |
| `point-read`           | Random indexed reads                                |
| `point-update`         | Repeated single-element updates                     |
| `point-insert`         | Repeated middle insertions                          |
| `point-delete`         | Repeated middle deletions                           |
| `batch-update`         | Update up to 1,000 selected indexes per transaction |
| `range-delete`         | Delete a contiguous range                           |
| `snapshot`             | Retain multiple snapshots of one collection         |
| `sequential-iteration` | Traverse the collection                             |
| `mixed-operations`     | 70% reads, 20% updates, 5% inserts, 5% deletes      |

The random workload uses a seeded generator. The same seed produces the same index sequence across adapters.

## Measurements

Each result includes p50, p95 and p99 per-operation latency, median operations per second, the measured sample duration, memory deltas and a checksum. JSON reports also include the Node.js version and platform.

By default, the harness calibrates operation counts to a 25 ms measured sample. This gives short operations enough repetitions to produce useful timings while keeping expensive operations bounded. Workloads that consume collection contents or retain snapshots have workload-specific iteration limits. Use `--iterations` to set a fixed operation count, or `--target-ms` to change the target duration.

Memory changes are sampled before and after each round. With explicit GC enabled, heap, external and ArrayBuffer measurements describe the post-round retained-memory delta; they are not total allocation counts. Without explicit GC, the deltas also reflect garbage-collection timing. RSS shows the process-level change. Run Node with `--expose-gc` when you want the harness to request garbage collection before and after each measured round. The report records whether explicit GC was available:

```sh
node --expose-gc --experimental-strip-types src/cli.ts --sizes 100000,1000000
```

Use the same runtime, hardware, dataset, warm-up, rounds and target duration for comparisons. Close other CPU-heavy applications and repeat runs when results are close. Percentiles are calculated across measured rounds, so increase `--rounds` when tail-latency estimates matter.

## Browser runs

The browser page compares native arrays, Immer, Mutative and Immutable.js using the same workload definitions. Browser runs use the workload's fixed default iteration count rather than the Node runner's duration calibration. Heap values are shown when the browser exposes `performance.memory`. Browser results include the user agent and hardware concurrency in the exported JSON.

## Example commands

```sh
pnpm bench -- --size 1000000 --workload point-update --rounds 21 --target-ms 50
pnpm bench -- --sizes 100000,1000000 --adapter native-copy,immer,mutative,immutable-js --format json --output reports/collections.json
```

## Tree allocation and retained-memory profiling

Use the dedicated V8 sampling profiler to compare the 256-element B+ and RRB candidates:

```sh
pnpm profile:trees
pnpm profile:trees:large
```

The profiler runs with `--expose-gc`, samples V8 allocations during a deterministic point-update sequence, reports the largest sampled allocation sites, and times a full traversal. It then retains a sequence of persistent versions, forces collection, records the retained heap, releases those versions, and measures again while keeping the base vector alive.

`sampledAllocations` is V8's statistical allocation sample, not an exact count of every allocation. `retainedDelta` measures the extra live memory held by the retained versions after collection. `releasedDelta` shows the remaining change after the snapshots are released. Compare candidates in the same Node version and process conditions; use multiple runs when the differences are small.
