# Architecture decisions

These decisions define the starting point for ArrayForge implementation.

## ADR-001: Evaluate B+ tree and RRB tree before choosing

**Decision:** Build comparable benchmark candidates for a persistent B+ tree and a relaxed radix-balanced tree.

**Reason:** Both structures offer structural sharing, but their behaviour differs across indexed access, sequence edits, concatenation and iteration. The workload results will determine the primary implementation.

## ADR-002: Use adaptive reference page capacity

**Decision:** Evaluate bounded page capacities of 256, 512 and 1024 elements, then select an adaptive policy from measured results.

**Reason:** Page size affects copy cost, tree depth, memory overhead and iteration locality. A single fixed capacity should not be selected without measurements.

## ADR-003: Share collection interfaces across specialized storage

**Decision:** Reference and numeric collections expose shared collection-level interfaces while retaining specialized page implementations. Bit-packed and sparse storage follow the same separation.

**Reason:** Consumers get a consistent API while each backend uses a representation suited to its data.

## ADR-004: Support callback transactions and explicit builders

**Decision:** Provide both `transact(callback)` and builder/commit workflows.

**Reason:** Callback transactions are concise for application code. Explicit builders suit longer mutation sequences and integrations that need a visible commit boundary.

## ADR-005: Start with TypeScript

**Decision:** Implement the initial engine in TypeScript. Consider WebAssembly for measured hot paths later.

**Reason:** TypeScript keeps the initial implementation easy to inspect, debug and integrate with JavaScript. A later WASM backend can focus on operations where it improves end-to-end performance.

## ADR-006: Use JavaScript garbage collection for version lifetime

**Decision:** Let unreachable roots, nodes and pages be reclaimed by the JavaScript runtime.

**Reason:** Immutable roots naturally express shared ownership through object reachability. Manual reference counting would add complexity to the initial engine and its worker boundaries.

## ADR-007: Keep published storage immutable

**Decision:** Never mutate a page or tree node reachable from a committed root.

**Reason:** This invariant makes snapshots safe to share and gives transactions a clear copy-on-write boundary.

## ADR-008: Keep both tree candidates under evaluation

**Decision:** Retain both persistent B+ tree and RRB-style candidates. `Vector` currently defaults to the RRB-style implementation while the primary structure remains unselected.

**Reason:** The measured workloads do not identify a consistent winner. RRB has an advantage in range deletion, while B+ is competitive or faster in point operations, batch updates and snapshots. Mixed workloads, optimized iteration and controlled memory measurements are part of the remaining evaluation.

## ADR-009: Select reference page capacity from workload profile

**Decision:** Support 256, 512 and 1024 element pages. The balanced profile selects 256 elements up to 100K items and 512 above that size. Mutation-heavy workloads use 256-element pages. Read-heavy workloads use 1024-element pages from one million items upward.

**Reason:** The benchmark runs showed different page sizes working well for mutation batches and sequential iteration. The profile makes that trade-off explicit at construction time.
