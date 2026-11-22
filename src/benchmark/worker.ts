import { parentPort, workerData } from 'node:worker_threads';
import { benchmark } from './measure.ts';
import { loadAdapters } from './adapters.ts';
import type { BenchmarkOptions, WorkloadName } from './types.ts';

interface WorkerInput {
  readonly adapter: string;
  readonly workload: WorkloadName;
  readonly options: BenchmarkOptions;
  readonly iterations: number | null;
}

async function main(): Promise<void> {
  if (!parentPort) {
    throw new Error('Benchmark worker must run inside a worker thread.');
  }

  const input = workerData as WorkerInput;
  const loaded = await loadAdapters([input.adapter]);
  const adapter = loaded.find((item) => item.adapter?.name === input.adapter)?.adapter;

  if (!adapter) {
    const reason =
      loaded.find((item) => item.reason)?.reason ?? `Adapter ${input.adapter} is unavailable.`;
    throw new Error(reason);
  }

  const result = benchmark(adapter, input.workload, input.options, input.iterations ?? undefined);
  parentPort.postMessage({ result });
}

main().catch((error: unknown) => {
  parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) });
});
