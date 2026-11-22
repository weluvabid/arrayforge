# Benchmark methodology

The benchmark lab compares the persistent tree implementations with several common collection strategies. It is intended for repeatable comparisons on the same runtime and machine, not as a universal ranking across environments.

## Adapters

- `native-copy` — native arrays with a full copy for immutable updates.
- `immer` — Immer `produce`.
- `mutative` — Mutative `create`.
- `immutable-js` — Immutable.js `List`.
- `bplus-*` and `rrb-*` — ArrayForge's independent persistent tree engines at the named page capacity.

## Workloads

| Workload               | What it measures                                                  |
| ---------------------- | ----------------------------------------------------------------- |
| `construction`         | Building a collection from an existing values array               |
| `point-read`           | Seeded random indexed reads                                       |
| `point-update`         | Repeated single-item updates                                      |
| `point-insert`         | Repeated insertions                                               |
| `point-delete`         | Sequential deletions from the evolving collection                 |
| `batch-update`         | Groups of indexed writes, with alternating values between passes  |
| `range-delete`         | Sequential removal of contiguous ranges                           |
| `snapshot`             | Retaining multiple immutable versions                             |
| `sequential-iteration` | Full traversal through the iterator protocol                      |
| `sequential-visit`     | Full traversal through direct callback visitation (`forEach`)     |
| `mixed-operations`     | A seeded mix of 70% reads, 20% updates, 5% inserts and 5% deletes |
| `mutation-churn`       | Random delete/insert pairs that preserve collection length        |

Workload-specific setup and seeded index sequences are prepared outside the measured section. Non-construction workloads create their initial collection before timing. Construction times collection creation itself. Delete and range-delete operations apply to the evolving collection for every adapter.

## Measurements

Each result records the number of measured rounds and iterations, sample duration, p50/p95/p99 of the per-iteration sample latency, operations per second, memory deltas, checksum and—when supported—post-workload tree structure statistics.

The Node runner calibrates iteration counts toward a 25 ms sample by default, subject to workload-specific caps. Use `--iterations` to set a fixed count or `--target-ms` to change the target duration. A workload that hits an iteration cap can finish below the target duration; the actual duration is recorded.

Percentiles are calculated across measured rounds. They are not per-operation traces, and p95/p99 are not meaningful when the run has only a handful of rounds. Increase `--rounds` for tail comparisons.

## Memory and allocation

The regular benchmark records memory before and after each round. Without explicit GC, those deltas are affected by garbage-collection timing and should not be interpreted as allocation volume or stable retained memory. Run with `--expose-gc` to request collection around measured rounds; even then, the delta describes retained memory, not all allocations made during the workload.

Use the dedicated V8 sampling profiler for allocation attribution:

```sh
pnpm profile:trees
pnpm profile:trees:large
```

The profiler samples allocations during point updates, iterator traversal, callback traversal and mutation churn. V8 sampling is statistical, not an exact count of every allocation. The same script also retains snapshots, forces collection and measures the extra live heap while keeping the base vector alive.

## Browser runs

Start the browser benchmark page with `pnpm bench:browser` and build it with `pnpm bench:browser:build`. The browser runner uses fixed workload iteration counts rather than the Node runner's duration calibration. It reports the user agent and hardware concurrency. Heap usage is shown only when the browser exposes `performance.memory`; browser runs do not force garbage collection.

## Reproducibility

Use the same runtime, hardware, dataset, seed, warm-up count, measured rounds and target duration. Close CPU-heavy applications and repeat runs when differences are small. Record the runtime and platform with exported results.
