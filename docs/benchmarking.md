# Benchmarking

Run these commands from an ArrayForge repository checkout. The benchmark lab compares the persistent tree implementations with native arrays, Immer, Mutative and Immutable.js.

## Workloads

| Workload               | What it measures                                  |
| ---------------------- | ------------------------------------------------- |
| `point-read`           | Random indexed reads                              |
| `point-update`         | Repeated single-item updates                      |
| `point-insert`         | Repeated insertions                               |
| `point-delete`         | Repeated deletions                                |
| `batch-update`         | Groups of indexed writes                          |
| `range-delete`         | Removal of a contiguous range                     |
| `snapshot`             | Retaining immutable versions                      |
| `sequential-iteration` | Traversing the complete collection                |
| `mixed-operations`     | 70% reads, 20% updates, 5% inserts and 5% deletes |

The random workloads use a seeded generator, so the same seed produces the same index sequence across adapters. The batch-update workload alternates between two update sets on successive passes, so each pass writes new values.

## Run the Node benchmarks

```sh
pnpm bench:trees
pnpm bench:trees:large
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

Run with explicit garbage collection:

```sh
pnpm profile:trees
pnpm profile:trees:large
```

The benchmark report includes p50, p95 and p99 latency, throughput, sample duration, heap delta, external-memory delta, ArrayBuffer delta and whether explicit GC was available. GC-enabled memory deltas describe retained memory after the measured round; they are not total allocation counts.

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
