# ArrayForge

ArrayForge is a persistent collection engine for JavaScript and TypeScript. It is designed for applications that work with large datasets and need efficient updates, snapshots and history.

## Current work

The benchmark laboratory compares native JavaScript arrays with Immer, Mutative and Immutable.js. It includes workloads for reads, updates, inserts, deletes, batch updates, range deletes, snapshots and sequential iteration.

The browser and command-line runners compare all five adapters and export results as JSON or CSV.

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

Open [http://127.0.0.1:4173](http://127.0.0.1:4173), choose a dataset and workload, then run the comparison. The page compares native arrays, Immer, Mutative and Immutable.js in the same browser runtime. Chromium may expose heap measurements through `performance.memory`; other browsers may leave that field unavailable.

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

## Architecture

- [Architecture specification](docs/architecture/specification.md)
- [Architecture overview](docs/architecture/overview.md)
- [Engineering roadmap](docs/roadmap.md)
- [Architecture decisions](docs/architecture/decisions.md)
- [Benchmark methodology](docs/benchmarks/methodology.md)
- [Initial benchmark run](docs/benchmarks/initial-run.md)

The tree selection, page sizing and storage details are recorded in the architecture decisions and will be evaluated through the benchmark work.
