import { performance } from 'node:perf_hooks';
import { RRBVector } from '../src/persistent/tree.ts';

function readIntegerArgument(name, fallback) {
  const position = process.argv.indexOf(`--${name}`);

  if (position === -1) {
    return fallback;
  }

  const value = Number(process.argv[position + 1]);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`--${name} must be a positive safe integer.`);
  }

  return value;
}

function percentile(values, percentage) {
  const index = Math.min(values.length - 1, Math.ceil((percentage / 100) * values.length) - 1);

  return values[index] ?? 0;
}

const size = readIntegerArgument('size', 1_000_000);
const warmup = readIntegerArgument('warmup', 3);
const rounds = readIntegerArgument('rounds', 9);
const pageSize = readIntegerArgument('page-size', 256);
const fanout = readIntegerArgument('fanout', 32);
const values = Array.from({ length: size }, (_, index) => index);
const source = RRBVector.from(values, { pageSize, branchFactor: fanout });
const midpoint = Math.floor(size / 2);
const sliceStart = Math.floor(size * 0.1);
const sliceEnd = Math.floor(size * 0.9);
const deleteCount = Math.floor(size * 0.8);
const spliceStart = Math.floor((size - deleteCount) / 2);
const insertedCount = Math.min(1_000, Math.max(1, Math.floor(size / 100)));
const inserted = Array.from({ length: insertedCount }, (_, index) => -index - 1);
const left = source.slice(0, midpoint);
const right = source.slice(midpoint, size);
const cases = [
  {
    name: `slice(${sliceStart}, ${sliceEnd})`,
    expectedLength: sliceEnd - sliceStart,
    run: () => source.slice(sliceStart, sliceEnd),
  },
  {
    name: `concat(${left.length}, ${right.length})`,
    expectedLength: size,
    run: () => left.concat(right),
  },
  {
    name: `splice(${spliceStart}, ${deleteCount}, ${inserted.length} inserted)`,
    expectedLength: size - deleteCount + inserted.length,
    run: () => source.splice(spliceStart, deleteCount, ...inserted),
  },
];

const gcAvailable = typeof globalThis.gc === 'function' ? 'yes' : 'no';

process.stdout.write(
  `Node ${process.version} · ${process.platform}/${process.arch} · ` +
    `${size.toLocaleString()} values · ` +
    `page ${pageSize} · fanout ${fanout} · explicit GC ${gcAvailable}\n`,
);

for (const benchmark of cases) {
  for (let iteration = 0; iteration < warmup; iteration += 1) {
    const result = benchmark.run();
    result.assertValid();
  }

  const samples = [];
  let checksum = 0;

  for (let iteration = 0; iteration < rounds; iteration += 1) {
    globalThis.gc?.();

    const startedAt = performance.now();
    let result = benchmark.run();
    const elapsedMs = performance.now() - startedAt;
    const resultLength = result.length;

    result.assertValid();

    if (resultLength !== benchmark.expectedLength) {
      throw new Error(
        `${benchmark.name} returned ${resultLength}; expected ${benchmark.expectedLength}.`,
      );
    }

    samples.push(elapsedMs);
    checksum += resultLength;
    result = undefined;
  }

  samples.sort((leftSample, rightSample) => leftSample - rightSample);
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);

  process.stdout.write(
    `${benchmark.name}: p50 ${p50.toFixed(3)}ms · p95 ${p95.toFixed(3)}ms · ` +
      `checksum ${checksum}\n`,
  );
}
