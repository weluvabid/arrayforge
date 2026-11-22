import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { loadAdapters } from './benchmark/adapters.ts';
import { maximumIterations } from './benchmark/measure.ts';
import { printTable, toCsv } from './benchmark/report.ts';
import { workloadNames } from './benchmark/workloads.ts';
import type { BenchmarkOptions, BenchmarkRunResult, WorkloadName } from './benchmark/types.ts';

interface CliArguments {
  sizes: number[];
  adapters: string[];
  workloads: WorkloadName[];
  rounds: number;
  warmup: number;
  iterations: number | null;
  targetSampleMs: number;
  timeoutMs: number;
  seed: number;
  format: 'table' | 'json' | 'csv';
  output: string | null;
  list: boolean;
}

function readValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }

  return value;
}

function parseNumber(value: string, flag: string, minimum: number): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseArguments(args: readonly string[]): CliArguments {
  const parsed: CliArguments = {
    sizes: [100_000, 1_000_000],
    adapters: ['all'],
    workloads: [...workloadNames],
    rounds: 11,
    warmup: 3,
    iterations: null,
    targetSampleMs: 25,
    timeoutMs: 2_000,
    seed: 42,
    format: 'table',
    output: null,
    list: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case '--size':
      case '--sizes':
        parsed.sizes = parseList(readValue(args, index, argument)).map((value) =>
          parseNumber(value, argument, 1),
        );
        index += 1;
        break;
      case '--adapter':
        parsed.adapters = parseList(readValue(args, index, argument));
        index += 1;
        break;
      case '--workload': {
        const requested = parseList(readValue(args, index, argument));
        parsed.workloads = requested.includes('all')
          ? [...workloadNames]
          : (requested as WorkloadName[]);
        index += 1;
        break;
      }
      case '--rounds':
        parsed.rounds = parseNumber(readValue(args, index, argument), argument, 1);
        index += 1;
        break;
      case '--warmup':
        parsed.warmup = parseNumber(readValue(args, index, argument), argument, 0);
        index += 1;
        break;
      case '--iterations':
        parsed.iterations = parseNumber(readValue(args, index, argument), argument, 1);
        index += 1;
        break;
      case '--target-ms':
        parsed.targetSampleMs = parseNumber(readValue(args, index, argument), argument, 1);
        index += 1;
        break;
      case '--timeout-ms':
        parsed.timeoutMs = parseNumber(readValue(args, index, argument), argument, 1);
        index += 1;
        break;
      case '--seed':
        parsed.seed = parseNumber(readValue(args, index, argument), argument, 0);
        index += 1;
        break;
      case '--format': {
        const format = readValue(args, index, argument);

        if (format !== 'table' && format !== 'json' && format !== 'csv') {
          throw new Error('--format must be table, json or csv.');
        }

        parsed.format = format;
        index += 1;
        break;
      }
      case '--output':
        parsed.output = readValue(args, index, argument);
        index += 1;
        break;
      case '--list':
        parsed.list = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;

      default:
        throw new Error(`Unknown argument: ${argument ?? ''}`);
    }
  }

  if (parsed.sizes.length === 0 || parsed.adapters.length === 0 || parsed.workloads.length === 0) {
    throw new Error('Sizes, adapters and workloads must each contain at least one value.');
  }

  for (const workload of parsed.workloads) {
    if (!workloadNames.includes(workload)) {
      throw new Error(`Unknown workload: ${workload}`);
    }
  }

  return parsed;
}

function printHelp(): void {
  process.stdout.write('ArrayForge benchmark laboratory\n\n');
  process.stdout.write('Usage: pnpm bench -- [options]\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write('  --sizes 100000,1000000   Dataset sizes\n');
  process.stdout.write('  --adapter all            all installed adapters\n');
  process.stdout.write('  --workload all           workload or comma-separated workloads\n');
  process.stdout.write('  --rounds 11              measured rounds\n');
  process.stdout.write('  --warmup 3               warm-up rounds\n');
  process.stdout.write(
    '  --iterations N           fixed operations per round (disables calibration)\n',
  );
  process.stdout.write('  --target-ms 25            target duration per measured round\n');
  process.stdout.write('  --timeout-ms 2000         hard per-adapter/workload timeout\n');
  process.stdout.write('  --seed 42                deterministic workload seed\n');
  process.stdout.write('  --format table            table, json or csv\n');
  process.stdout.write('  --output report.json      write results to a file\n');
  process.stdout.write('  --list                    list installed adapters and workloads\n');
}

interface WorkerMessage {
  readonly result?: BenchmarkRunResult;
  readonly error?: string;
}

function runIsolatedBenchmark(
  adapter: string,
  workload: WorkloadName,
  options: BenchmarkOptions,
  iterations: number | null,
  timeoutMs: number,
): Promise<BenchmarkRunResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./benchmark/worker.ts', import.meta.url), {
      workerData: { adapter, workload, options, iterations },
      execArgv: process.execArgv,
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      worker
        .terminate()
        .then(
          () => resolve({ status: 'timeout', adapter, workload, size: options.size, timeoutMs }),
          reject,
        );
    }, timeoutMs);

    worker.once('message', (message: WorkerMessage) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (message.error) {
        reject(new Error(message.error));
      } else if (message.result) {
        resolve(message.result);
      } else {
        reject(new Error(`Benchmark worker returned no result for ${adapter}/${workload}.`));
      }
    });
    worker.once('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Benchmark worker exited with code ${code} for ${adapter}/${workload}.`));
    });
  });
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const loaded = await loadAdapters(args.adapters);
  const adapters = loaded.flatMap((result) => (result.adapter ? [result.adapter] : []));

  if (args.list) {
    process.stdout.write('Adapters:\n');

    for (const result of loaded) {
      process.stdout.write(
        result.adapter
          ? `  ${result.adapter.name}: ${result.adapter.description}\n`
          : `  unavailable: ${result.reason ?? 'unknown reason'}\n`,
      );
    }

    process.stdout.write(`\nWorkloads:\n  ${workloadNames.join('\n  ')}\n`);
    return;
  }

  if (adapters.length === 0) {
    throw new Error('No benchmark adapters are available.');
  }

  for (const result of loaded) {
    if (!result.adapter && result.reason) {
      process.stderr.write(`Skipping ${result.reason}\n`);
    }
  }

  const results: BenchmarkRunResult[] = [];

  for (const size of args.sizes) {
    const options: BenchmarkOptions = {
      size,
      rounds: args.rounds,
      warmup: args.warmup,
      seed: args.seed,
      targetSampleMs: args.targetSampleMs,
    };

    for (const adapter of adapters) {
      for (const workload of args.workloads) {
        const iterations =
          args.iterations === null
            ? null
            : Math.min(args.iterations, maximumIterations(workload, size));
        process.stderr.write(
          `Running ${adapter.name} / ${workload} / ${size.toLocaleString('en-US')} ` +
            `(${
              iterations === null ? `calibrated to ${args.targetSampleMs}ms` : `${iterations} ops`
            })\n`,
        );
        const result = await runIsolatedBenchmark(
          adapter.name,
          workload,
          options,
          iterations,
          args.timeoutMs,
        );
        results.push(result);

        if (result.status === 'timeout') {
          process.stderr.write(
            `Timed out ${adapter.name} / ${workload} / ${size.toLocaleString('en-US')} ` +
              `after ${args.timeoutMs}ms; result excluded from performance comparisons\n`,
          );
        }
      }
    }
  }

  const output =
    args.format === 'json'
      ? JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            runtime: process.version,
            platform: `${process.platform}-${process.arch}`,
            results,
          },
          null,
          2,
        )
      : args.format === 'csv'
        ? toCsv(results)
        : printTable(results);

  if (args.output) {
    await mkdir(dirname(args.output), { recursive: true });
    await writeFile(args.output, `${output}\n`, 'utf8');
    process.stdout.write(`Wrote ${args.output}\n`);
  } else {
    process.stdout.write(`${output}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Benchmark failed: ${message}\n`);
  process.exitCode = 1;
});
