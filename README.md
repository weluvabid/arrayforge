# ArrayForge

ArrayForge is a persistent collection engine for JavaScript and TypeScript. It is designed for applications that work with large datasets and need efficient updates, snapshots and history.

## Current work

The benchmark laboratory compares native JavaScript arrays, Immer, Mutative, Immutable.js and ArrayForge's persistent tree candidates. It includes workloads for reads, updates, inserts, deletes, batch updates, range deletes, snapshots, sequential iteration and mixed operations.

ArrayForge includes persistent RRB-style and balanced B+ tree candidates. `Vector` currently defaults to the RRB-style candidate while broader workload evaluation continues. Reference pages support 256, 512 and 1024 elements, with adaptive sizing profiles.

The browser and command-line runners compare the available adapters and export results as JSON or CSV.

## Requirements

- Node.js 26.13.0
- pnpm 12

Install the project dependencies:

```sh
pnpm install
```

## Run the benchmark lab

Run a quick local suite:

```sh
pnpm bench:smoke
```

Run the default suite:

```sh
pnpm bench
```

Compare the tree candidates:

```sh
pnpm bench:trees
pnpm bench:trees:large
```

Choose dataset sizes, adapters and workloads:

```sh
pnpm bench -- --sizes 100000,1000000 --adapter native-copy,immer --workload point-update,batch-update
```

Save a machine-readable report:

```sh
pnpm bench -- --sizes 100000,1000000 --format json --output reports/baseline.json
pnpm bench -- --sizes 100000,1000000 --format csv --output reports/baseline.csv
```

The runner records runtime and platform information in JSON reports. Use the same machine, Node.js version, dataset sizes and benchmark options when comparing runs.

## Browser benchmarks

Start the browser runner:

```sh
pnpm bench:browser
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173), choose a dataset and workload, then run the comparison. The page compares native arrays, Immer, Mutative, Immutable.js and the B+ and RRB-style tree candidates in the same browser runtime. Chromium may expose heap measurements through `performance.memory`; other browsers may leave that field unavailable.

Build the browser runner:

```sh
pnpm bench:browser:build
```

## Development

```sh
pnpm check
pnpm bench:smoke
```

`pnpm check` runs formatting, linting, TypeScript checks and tests. Git hooks can be installed with:

```sh
sh scripts/install-hooks.sh
```

## Persistent vectors

```ts
import { Vector } from './src/index.ts';

const records = Vector.from([10, 20, 30]);
const updated = records.set(1, 200);
const next = updated.insert(2, 250);

console.log(records.toArray()); // [10, 20, 30]
console.log(next.toArray()); // [10, 200, 250, 30]
```

Page sizing can be selected with `balanced`, `mutation-heavy` or `read-heavy` profiles. The B+ tree candidate remains available for benchmark comparisons.

## Architecture

- [Architecture specification](docs/architecture/specification.md)
- [Tree evaluation](docs/architecture/tree-evaluation.md)
- [Phase 2 benchmark results](docs/benchmarks/phase-2-tree-evaluation.md)
- [Architecture overview](docs/architecture/overview.md)
- [Engineering roadmap](docs/roadmap.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Benchmark methodology](docs/benchmarks/methodology.md)
- [Iteration optimization](docs/benchmarks/iteration-optimization.md)
- [Initial benchmark run](docs/benchmarks/initial-run.md)
