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

The random workload uses a seeded generator. The same seed produces the same index sequence across adapters.

## Measurements

Each result includes p50, p95 and p99 per-operation latency, median operations per second, changes in heap, external, ArrayBuffer and resident memory, and a checksum. JSON reports also include the Node.js version and platform.

Memory changes are sampled before and after each round. Heap, external and ArrayBuffer measurements help track JavaScript objects and typed-array storage; RSS shows the process-level change. Run Node with `--expose-gc` when you want the harness to request garbage collection before and after each measured round:

```sh
node --expose-gc --experimental-strip-types src/cli.ts --sizes 100000,1000000
```

Use the same runtime, hardware, dataset, warm-up, rounds and iteration counts for comparisons. Close other CPU-heavy applications and repeat runs when results are close.

## Browser runs

The browser page compares native arrays, Immer, Mutative and Immutable.js using the same workload definitions. Heap values are shown when the browser exposes `performance.memory`. Browser results include the user agent and hardware concurrency in the exported JSON.

## Example commands

```sh
pnpm bench -- --size 1000000 --workload point-update --rounds 7
pnpm bench -- --sizes 100000,1000000 --adapter native-copy,immer,mutative,immutable-js --format json --output reports/collections.json
```
