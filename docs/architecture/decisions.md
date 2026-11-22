# Architecture decisions

These decisions describe the architecture shipped in ArrayForge 0.1.0 and the areas intentionally deferred.

## ADR-001: Implement independent persistent tree candidates

**Decision:** Maintain separate B+ and RRB implementations behind one collection interface.

**Reason:** Their balancing and occupancy policies are materially different. Separate node representations and algorithms make correctness and workload comparisons meaningful.

## ADR-002: Select page capacity by workload profile

**Decision:** Use 256-element pages for balanced and mutation-heavy workloads, 512 for read-heavy collections below one million elements, and 1024 for read-heavy collections from one million elements upward.

**Reason:** Page size affects copy cost, tree depth, memory overhead and iteration locality. The measured workload trade-offs favour a small balanced default with larger read-specialized configurations.

## ADR-003: Keep specialized storage backends out of the initial release

**Decision:** The initial release supports reference-page vectors only. Numeric typed-array pages, bit-packed storage and sparse/tombstone backends are deferred.

**Reason:** The current implementation and benchmark evidence focus on the B+ and RRB reference-page engines. Deferring other representations keeps the public contract and release scope aligned with code that exists and is tested.

## ADR-004: Support callback transactions and explicit builders

**Decision:** Provide both `transact(callback)` and builder/commit workflows.

**Reason:** Callback transactions are concise for application code. Explicit builders suit longer mutation sequences and integrations that need a visible commit boundary.

## ADR-005: Start with TypeScript

**Decision:** Implement the initial engine in TypeScript. Consider WebAssembly for measured hot paths later.

**Reason:** TypeScript keeps the initial implementation easy to inspect, debug and integrate with JavaScript. A later WASM backend can focus on operations where it improves end-to-end performance.

## ADR-006: Use JavaScript garbage collection for version lifetime

**Decision:** Let unreachable roots, nodes and pages be reclaimed by the JavaScript runtime.

**Reason:** Immutable roots naturally express shared ownership through object reachability. Manual reference counting would add complexity without improving the initial engine’s root-sharing model.

## ADR-007: Keep published storage immutable

**Decision:** Never mutate a page or tree node reachable from a committed root.

**Reason:** This invariant makes snapshots safe to share and gives transactions a clear copy-on-write boundary.

## ADR-008: Select RRB as the primary persistent sequence structure

**Decision:** Use the independently implemented RRB tree as the primary vector engine. Keep the independently implemented B+ tree as a supported alternative.

**Reason:** The comparative evaluation showed a workload split rather than a universal winner. RRB provides a strong general sequence engine, particularly for reads, insertions and direct traversal in the later scale runs; B+ remains competitive or faster for point updates, deletes and some batch/range workloads. Both implementations have separate node representations, structural invariants and mutation algorithms, so keeping both gives callers a meaningful choice.

## ADR-009: Use 256-element pages as the balanced default

**Decision:** Use 256-element reference pages for balanced and mutation-heavy vectors. Use 512-element pages for read-heavy collections below one million elements and 1024-element pages for read-heavy collections from one million elements upward.

**Reason:** The benchmark comparison shows 256 as the most consistent general-purpose choice for point mutation and mixed workloads. Larger pages can improve read throughput at scale, but increase copy costs for updates. Page capacity is fixed for each vector's lifetime.

## ADR-010: Batch transaction writes by touched page

**Decision:** Provide callback transactions and explicit builders. Accumulate point writes and commit them through a sorted `setMany()` traversal. Flush pending writes before structural operations to preserve operation order.

**Reason:** A batch traverses each affected subtree once, copies each touched leaf once and rebuilds each affected ancestor once. This avoids repeatedly copying the same page for multiple writes within a transaction while preserving immutable published roots.

## ADR-011: Use arithmetic descent for uniform child ranges

**Decision:** Store a uniform child span on branch nodes when all child subtrees have equal size. Use arithmetic child selection and prefix calculation for those branches; retain cumulative-size binary search for ragged branches.

**Reason:** Regular subtrees are common in both engines and do not need a binary search. The fallback preserves correctness for RRB relaxed nodes and B+ branches with uneven final groups.

## ADR-012: Rebalance underfilled RRB siblings after deletion

**Decision:** After point or range deletion, merge or redistribute adjacent RRB siblings when the changed child falls below half occupancy. Keep the RRB relaxed size table and independent node representation.

**Reason:** Sustained random delete/insert workloads previously produced sparse leaves and substantially higher node counts. Rebalancing restored leaf occupancy and brought RRB churn throughput back in line with B+.

## ADR-013: Construct final mutation arrays in one pass

**Decision:** Build inserted, removed and rebalanced page/child arrays directly rather than cloning an array and then shifting it with `splice()`.

**Reason:** V8 allocation sampling identified array construction and tree insertion/deletion paths as important churn allocation sites. Direct construction reduces intermediate arrays while preserving immutable path copying; the exact allocation effect depends on the workload and runtime.
