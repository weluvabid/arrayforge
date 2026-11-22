# Architecture decisions

These decisions define the starting point for ArrayForge implementation.

## ADR-001: Implement independent persistent tree candidates

**Decision:** Maintain separate B+ and RRB implementations behind one collection interface.

**Reason:** Their balancing and occupancy policies are materially different. Separate node representations and algorithms make correctness and workload comparisons meaningful.

## ADR-002: Select page capacity by workload profile

**Decision:** Use 256-element pages for balanced and mutation-heavy workloads, 512 for read-heavy collections below one million elements, and 1024 for read-heavy collections from one million elements upward.

**Reason:** Page size affects copy cost, tree depth, memory overhead and iteration locality. The measured workload trade-offs favour a small balanced default with larger read-specialized configurations.

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

## ADR-008: Select RRB as the primary persistent sequence structure

**Decision:** Use the independently implemented RRB tree as the primary vector engine. Keep the independently implemented B+ tree as a supported alternative.

**Reason:** The 100K, 1M and 5M evaluation shows RRB's stronger overall fit across range deletion, large-dataset reads, iteration and batch updates. B+ remains competitive or faster for point updates and selected mixed workloads. Both implementations have separate node representations, structural invariants and mutation algorithms; the decision is no longer based on two policies over one shared implementation.

## ADR-009: Use 256-element pages as the balanced default

**Decision:** Use 256-element reference pages for balanced and mutation-heavy vectors. Use 512-element pages for read-heavy collections below one million elements and 1024-element pages for read-heavy collections from one million elements upward.

**Reason:** The benchmark comparison shows 256 as the most consistent general-purpose choice for point mutation and mixed workloads. Larger pages can improve read throughput at scale, but increase copy costs for updates. Page capacity is fixed for each vector's lifetime.

## ADR-010: Batch transaction writes by touched page

**Decision:** Provide callback transactions and explicit builders. Accumulate point writes and commit them through a sorted `setMany()` traversal. Flush pending writes before structural operations to preserve operation order.

**Reason:** A batch traverses each affected subtree once, copies each touched leaf once and rebuilds each affected ancestor once. This avoids repeatedly copying the same page for multiple writes within a transaction while preserving immutable published roots.
