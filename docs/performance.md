# Performance notes

The checked-in results compare the B+ and RRB engines across large datasets and representative collection operations.

## Test environment

The current result files were collected with Node.js 22.16.0 on Linux x64. The package itself targets Node.js 26.13.0, as recorded in `.node-version`, so these numbers are useful for comparing the implementations but should be rerun on the release runtime before publishing them as release benchmarks.

The scale run contains 5 measured rounds at each of 100K, 1M, 5M and 10M values. It did not force garbage collection. The dedicated mutation-churn run contains 7 measured rounds of 20,000 delete/insert pairs. The allocation/retention profile used explicit GC and V8 allocation sampling. Raw data is checked in under [`benchmarks/results`](benchmarks/results/).

## What the numbers say

At one million values, both trees are in the same general range for common point operations. RRB is a little quicker on reads, updates, insertions and deletions in this run; B+ is quicker on range deletion. Batch updates are effectively tied.

| Workload           |   B+ 256 |  RRB 256 |
| ------------------ | -------: | -------: |
| Point read         |  6.89M/s |  7.33M/s |
| Point update       |   677K/s |   693K/s |
| Point insert       |   827K/s |   891K/s |
| Point delete       |   827K/s |   864K/s |
| Batch update       |  1,120/s |  1,140/s |
| Range delete       |   355K/s |   252K/s |
| Iterator traversal | 15.39 ms | 15.41 ms |
| Callback traversal |  8.12 ms |  7.86 ms |

The earlier pre-correction evaluation reported an RRB advantage for range deletion, while the current scale run favours B+ at one and ten million values. Those runs used different benchmark revisions, so the old result is historical rather than a direct apples-to-apples comparison. The results show different strengths across the two engines and workloads.

At ten million values, the 256-page results were:

| Workload           |       B+ |      RRB | Lower latency |
| ------------------ | -------: | -------: | ------------- |
| Point read         | 0.448 µs | 0.432 µs | RRB           |
| Point update       | 2.389 µs | 2.549 µs | B+            |
| Point insert       | 1.419 µs | 1.242 µs | RRB           |
| Point delete       | 1.176 µs | 1.432 µs | B+            |
| Batch update       | 1.519 ms | 1.815 ms | B+            |
| Range delete       | 4.850 µs | 5.651 µs | B+            |
| Iterator traversal | 165.2 ms | 168.9 ms | B+            |
| Callback traversal |  87.3 ms |  85.2 ms | RRB           |
| Mixed operations   | 1.495 µs | 1.353 µs | RRB           |

The table reports the p50 latency per benchmark iteration. A traversal iteration visits the entire collection; a batch-update iteration applies its configured batch. Workload iteration counts are calibrated independently, so compare the reported operation definition as well as the time.

Callback traversal is the clearest API-level distinction: it avoids creating an iterator result for every yielded value and is about 1.9× faster than the iterator protocol at ten million values in this run. The iterator remains the natural choice for `for...of`; use `forEach()` when a full scan is on a hot path and callback semantics fit the caller.

## Mutation churn

The dedicated churn workload performs 20,000 seeded random delete/insert pairs while keeping the collection length constant. At one million values, the RRB engine improved from about 40K pairs/s before sibling rebalancing to about 196K pairs/s after it. Its leaf count fell from 6,852 to 5,869, and mean leaf occupancy rose from about 146 to 170. B+ measured about 197K pairs/s in the final run.

At five and ten million values, the two engines were also close in this workload: approximately 135K pairs/s at five million and 111–113K pairs/s at ten million. The structural statistics show both trees retaining a height of four at ten million values after the churn sequence.

## Navigation

A focused one-million-value point-read comparison measured 15 rounds before and after arithmetic descent was added for uniform child ranges:

| Engine  |        Before |         After | Change |
| ------- | ------------: | ------------: | -----: |
| B+ 256  | 5.09M reads/s | 8.28M reads/s | +62.6% |
| RRB 256 | 5.24M reads/s | 5.95M reads/s | +13.6% |

These are results from the isolated navigation experiment. The full scale run has its own measurements and should be used when comparing the complete workload matrix.

## Snapshots and allocation

The explicit-GC retention profile retained 64 snapshots of a one-million-value vector. The additional live heap was approximately 244 KB for each engine. After releasing those snapshots and collecting again, heap usage was close to the original baseline. That profile used a 4,096-byte V8 sampling interval; the script defaults differ, so the reproduction command below passes the recorded settings explicitly.

The V8 allocation profile also samples point updates, iterator traversal, callback traversal and mutation churn. Those figures help identify hot allocation sites, but sampling is statistical; they are not exact bytes allocated per operation. The regular scale benchmark did not force GC, so its heap deltas are intentionally not presented here as allocation or retained-memory claims.

## Choosing an engine

- Start with `Vector.from()` and its RRB default for general persistent sequence workloads.
- Benchmark both engines when point updates and deletes dominate; the mutation-heavy profile selects B+.
- Keep the default page size at 256 unless measurements from the target workload support 512 or 1024.
- Use `forEach()` for hot full scans when callback traversal is appropriate.

Neither tree wins every row. The default reflects the chosen general-purpose balance and RRB's sequence-oriented behaviour, while B+ remains a useful independent alternative.

## Reproduce the results

The checked-in scale result used 5 measured rounds, 2 warm-ups and a 20 ms target sample. Run that configuration with:

```sh
node --max-old-space-size=4096 --experimental-strip-types src/cli.ts \
  --sizes 100000,1000000,5000000,10000000 \
  --adapter bplus-256,rrb-256 \
  --rounds 5 --warmup 2 --target-ms 20 \
  --format json --output docs/benchmarks/results/final-scale-validation-node22.json
```

The dedicated churn run used 7 measured rounds, 2 warm-ups and 20,000 pairs per round:

```sh
pnpm bench:churn
```

The allocation/retention profile used explicit GC, 10,000 updates, 64 retained snapshots and a 4,096-byte sampling interval:

```sh
pnpm profile:trees -- --size 1000000 --updates 10000 \
  --snapshots 64 --sampling-interval 4096
```

For the checked-in runs, see:

- [`final-scale-validation-node22.json`](benchmarks/results/final-scale-validation-node22.json)
- [`mutation-churn-before-rebalance-node22.json`](benchmarks/results/mutation-churn-before-rebalance-node22.json)
- [`mutation-churn-final-node22.json`](benchmarks/results/mutation-churn-final-node22.json)
- [`navigation-baseline-node22.json`](benchmarks/results/navigation-baseline-node22.json)
- [`navigation-optimized-node22.json`](benchmarks/results/navigation-optimized-node22.json)
- [`allocation-profile-node22.json`](benchmarks/results/allocation-profile-node22.json)
