# Performance

ArrayForge includes separate B+ and RRB persistent tree implementations. The benchmark suite compares indexed operations, range operations, iteration, mixed workloads and retained heap across collection sizes.

## Results at five million items

The following measurements are from the GC-enabled Node benchmark run. Throughput is reported in operations per second; iteration latency is the time to traverse the full collection.

| Workload             | B+ 256   | RRB 256  | B+ 512   | RRB 512  |
| -------------------- | -------- | -------- | -------- | -------- |
| Point read           | 6.23M    | 6.20M    | 6.70M    | 6.81M    |
| Point update         | 1.28M    | 1.23M    | 1.18M    | 1.04M    |
| Point insert         | 1.83M    | 1.82M    | 1.45M    | 1.44M    |
| Point delete         | 3.46M    | 3.26M    | 3.21M    | 3.14M    |
| Range delete         | 574K     | 862K     | 354K     | 613K     |
| Sequential iteration | 30.98 ms | 30.68 ms | 30.25 ms | 30.37 ms |
| Mixed operations     | 2.59M    | 2.41M    | 2.64M    | 2.06M    |

The results show different strengths across the two structures. B+ 256 is strong in point mutations and mixed operations. RRB 256 leads range deletion. The two 256-page configurations have nearly identical sequential iteration times.

## Retained heap delta

| Collection size | B+ 256   | RRB 256  | B+ 512   | RRB 512  |
| --------------- | -------- | -------- | -------- | -------- |
| 100,000         | 0.81 MB  | 0.81 MB  | 0.79 MB  | 0.79 MB  |
| 1,000,000       | 8.10 MB  | 8.11 MB  | 7.87 MB  | 7.87 MB  |
| 5,000,000       | 40.49 MB | 40.54 MB | 39.32 MB | 39.35 MB |

These values are the benchmark's post-GC heap deltas. The ArrayBuffer delta rounded to 0.00 MB for these reference-page workloads.

## Choosing an implementation

- Choose B+ for general-purpose use and workloads with frequent point updates and deletes.
- Choose RRB for workloads with frequent batch-oriented and range operations.
- Start with `Vector.from()` and a workload profile when the access pattern is known.
- Use `BPlusVector.from()` or `RRBVector.from()` when the implementation should be explicit.
- Use `PAGE_SIZE` to select a page capacity for the application's data shape.

Both implementations expose the same collection API, so an application can change its choice without changing its collection logic.

## Persistent updates and snapshots

A point update copies the affected leaf page and the nodes along the path to the root. Unchanged subtrees remain shared with earlier versions. `snapshot()` returns the current immutable version, so taking a snapshot does not copy the collection.

Batch writes are grouped by index. Each affected page is updated once, and the ancestors of touched pages are rebuilt along the affected paths.
