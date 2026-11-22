# Initial benchmark lab run

The first smoke run exercised both native adapters across all eight workloads.

- Dataset: 10,000 elements
- Adapters: `native-copy`, `native-mutable`
- Workloads: 8
- Measured rounds: 3
- Warm-up rounds: 1
- Operations per round: 10
- Result format: CSV
- Tests: 10 passed

The report included latency percentiles, operations per second, heap change, external memory, ArrayBuffer memory, RSS and checksums.

The local run used Node.js 22.16.0 on Linux x64. The project runtime is Node.js 26.13.0.
