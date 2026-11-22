# Benchmarking

Run these commands from an ArrayForge repository checkout. The benchmark lab compares the persistent tree implementations with native arrays, Immer, Mutative and Immutable.js.

## Workloads

| Workload               | What it measures                                                      |
| ---------------------- | --------------------------------------------------------------------- |
| `construction`         | Building a collection from an existing values array                   |
| `point-read`           | Random indexed reads                                                  |
| `point-update`         | Repeated single-item updates                                          |
| `point-insert`         | Repeated insertions                                                   |
| `point-delete`         | Repeated deletions                                                    |
| `batch-update`         | Groups of indexed writes                                              |
| `range-delete`         | Removal of a contiguous range                                         |
| `snapshot`             | Retaining immutable versions                                          |
| `sequential-iteration` | Traversing the complete collection through the iterator protocol      |
| `sequential-visit`     | Traversing the complete collection through direct callback visitation |
| `mixed-operations`     | 70% reads, 20% updates, 5% inserts and 5% deletes                     |
| `mutation-churn`       | Random delete/insert pairs that preserve collection length            |

The random workloads use a seeded generator, so the same seed produces the same index sequence across adapters. Workload-specific setup is performed outside the timed section. The batch-update workload alternates between two update sets on successive passes, so each pass writes new values. Point-delete and range-delete apply sequential edits to the current collection for every adapter.

## Run the Node benchmarks

```sh
pnpm bench:trees
pnpm bench:trees:large
pnpm bench:scale
```

Run the full adapter comparison with:

```sh
pnpm bench
```

Select a workload and dataset:

```sh
pnpm bench -- --size 1000000 --workload point-update --rounds 21 --target-ms 50
```

Export machine-readable results:

```sh
pnpm bench -- --sizes 100000,1000000 --adapter bplus-256,rrb-256 --format json --output reports/tree-results.json
```

## Memory profiling

Run with explicit garbage collection and allocation sampling:

```sh
pnpm profile:trees
pnpm profile:trees:large
```

The profiler uses the V8 inspector sampling heap profiler to attribute sampled allocation bytes to functions. It profiles point updates, iterator traversal, callback traversal and random mutation churn, alongside retained-snapshot memory. Sampling results are estimates, not exact allocation counts, and should be compared using identical Node versions and sampling intervals. The checked-in one-million-value profile used 10,000 updates, 64 retained snapshots and a 4,096-byte sampling interval; pass those options explicitly when reproducing that run:

```sh
pnpm profile:trees -- --size 1000000 --updates 10000 --snapshots 64 --sampling-interval 4096
```

The benchmark report includes p50, p95 and p99 latency, throughput, sample duration, heap delta, external-memory delta, ArrayBuffer delta and whether explicit GC was available. Non-construction calibration excludes initial collection creation, matching the measured timing boundary. Persistent-tree adapters additionally report node counts, height and leaf/branch occupancy after the workload. GC-enabled memory deltas describe retained memory after the measured round; they are not total allocation counts. For allocation volume, use the sampling heap profiler below. `pnpm bench:churn` runs 20,000 deterministic delete/insert pairs per sample at 100K, 1M, 5M and 10M elements and reports post-churn structure statistics.

## Browser benchmarks

Start the browser benchmark page:

```sh
pnpm bench:browser
```

Build it for production:

```sh
pnpm bench:browser:build
```

Browser runs report the user agent and hardware concurrency. Heap measurements are shown when the browser exposes `performance.memory`.

## Comparing runs

Use the same Node version, hardware, dataset size, seed, warm-up count, measured rounds and target sample duration. Close CPU-heavy applications while measuring. Increase the number of rounds when comparing close results.

## RRB structural operations

Run `pnpm bench:structural` to measure subtree-sharing `slice`, `concat` and `splice` operations. The script accepts `--size`, `--warmup`, `--rounds`, `--page-size` and `--fanout`; it validates each result outside the timed interval.

### Per-workload timeout

Each adapter/workload/dataset-size run executes in its own worker thread. The CLI terminates that worker after 2,000 ms by default, so a synchronous workload cannot hold the benchmark suite indefinitely. Override the limit with `--timeout-ms N`.

A timed-out run is emitted with `status: "timeout"` and its timeout limit. It has no latency, throughput, checksum, or memory measurements and must be excluded from performance comparisons. The timeout is a completion classification, not a measured duration or a zero-throughput sample.
