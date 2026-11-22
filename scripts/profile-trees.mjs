import { Session } from 'node:inspector';
import { performance } from 'node:perf_hooks';
import { BPlusVector, RrbVector } from '../src/persistent/tree.ts';

const SIZE = readInteger('--size', 1_000_000);
const UPDATES = readInteger('--updates', 10_000);
const SNAPSHOTS = readInteger('--snapshots', 32);
const SAMPLE_INTERVAL = readInteger('--sampling-interval', 8_192);
const hasGc = typeof globalThis.gc === 'function';

function readInteger(flag, fallback) {
  const index = process.argv.indexOf(flag);

  if (index === -1) {
    return fallback;
  }

  const value = Number(process.argv[index + 1]);

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${flag} must be a positive safe integer.`);
  }

  return value;
}

function collectGarbage() {
  if (!hasGc) {
    throw new Error('Run with --expose-gc to measure retained heap.');
  }

  globalThis.gc();
  globalThis.gc();
}

function memory() {
  const { heapUsed, external, arrayBuffers, rss } = process.memoryUsage();

  return { heapUsed, external, arrayBuffers, rss };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function delta(before, after) {
  return Object.fromEntries(Object.keys(before).map((key) => [key, after[key] - before[key]]));
}

function post(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
}

function flattenProfile(profile) {
  const totals = new Map();
  const sampledNodes = new Map();

  for (const sample of profile.samples ?? []) {
    const current = sampledNodes.get(sample.nodeId) ?? { bytes: 0, count: 0 };
    current.bytes += sample.size;
    current.count += 1;
    sampledNodes.set(sample.nodeId, current);
  }

  function visit(node) {
    const callFrame = node.callFrame;
    const name = `${callFrame.functionName || '(anonymous)'} (${callFrame.url || 'native'})`;
    const sample = sampledNodes.get(node.id);
    const current = totals.get(name) ?? { sampledBytes: 0, samples: 0 };

    current.sampledBytes += sample?.bytes ?? 0;
    current.samples += sample?.count ?? 0;
    totals.set(name, current);

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(profile.head);

  return [...totals.entries()]
    .map(([functionName, value]) => ({ functionName, ...value }))
    .sort((left, right) => right.sampledBytes - left.sampledBytes)
    .slice(0, 20);
}

function createVector(kind, values) {
  const options = { pageSize: 256 };
  return kind === 'bplus' ? BPlusVector.from(values, options) : RrbVector.from(values, options);
}

async function startSampling(session) {
  await post(session, 'HeapProfiler.startSampling', {
    samplingInterval: SAMPLE_INTERVAL,
    includeObjectsCollectedByMajorGC: false,
    includeObjectsCollectedByMinorGC: false,
  });
}

async function stopSampling(session) {
  const result = await post(session, 'HeapProfiler.stopSampling');

  return flattenProfile(result.profile);
}

async function profileAllocations(kind, values) {
  const session = new Session();
  session.connect();

  try {
    let vector = createVector(kind, values);

    for (let index = 0; index < 1_000; index += 1) {
      vector = vector.set((index * 7_919) % vector.length, SIZE + index);
    }

    for (const value of vector) {
      void value;
    }

    vector = createVector(kind, values);
    await startSampling(session);

    const updateStartedAt = performance.now();

    for (let index = 0; index < UPDATES; index += 1) {
      const position = (index * 7_919) % vector.length;
      vector = vector.set(position, SIZE + index);
    }

    const updateDurationMs = performance.now() - updateStartedAt;
    const updateAllocations = await stopSampling(session);

    await startSampling(session);
    let sampledChecksum = 0;

    for (const value of vector) {
      sampledChecksum += value;
    }

    const iterationAllocations = await stopSampling(session);

    for (let warmup = 0; warmup < 3; warmup += 1) {
      for (const value of vector) {
        void value;
      }
    }

    const iterationDurations = [];
    let checksum = 0;

    for (let round = 0; round < 5; round += 1) {
      const iterationStartedAt = performance.now();
      let roundChecksum = 0;

      for (const value of vector) {
        roundChecksum += value;
      }

      iterationDurations.push(performance.now() - iterationStartedAt);
      checksum += roundChecksum;
    }

    const iterationDurationMs = median(iterationDurations);

    return {
      kind,
      updateDurationMs,
      iterationDurationMs,
      checksum: checksum + sampledChecksum,
      updateAllocations,
      iterationAllocations,
    };
  } finally {
    session.disconnect();
  }
}

function profileTransactions(kind, values) {
  const base = createVector(kind, values);
  const changes = Array.from({ length: UPDATES }, (_, index) => ({
    index: (index * 7_919) % base.length,
    value: SIZE + index,
  }));
  const runSequential = () => {
    let vector = base;

    for (const change of changes) {
      vector = vector.set(change.index, change.value);
    }

    return vector;
  };
  const runTransaction = () =>
    base.transact((draft) => {
      for (const change of changes) {
        draft.set(change.index, change.value);
      }
    });

  for (let warmup = 0; warmup < 2; warmup += 1) {
    runSequential();
    runTransaction();
  }

  const sequentialDurations = [];
  const transactionDurations = [];
  let sequential;
  let transactional;

  for (let round = 0; round < 5; round += 1) {
    let startedAt = performance.now();
    sequential = runSequential();
    sequentialDurations.push(performance.now() - startedAt);
    collectGarbage();

    startedAt = performance.now();
    transactional = runTransaction();
    transactionDurations.push(performance.now() - startedAt);
    collectGarbage();
  }

  let sequentialChecksum = 0;
  let transactionChecksum = 0;

  for (const change of changes) {
    sequentialChecksum += sequential.get(change.index) ?? 0;
    transactionChecksum += transactional.get(change.index) ?? 0;
  }

  if (
    sequentialChecksum !== transactionChecksum ||
    base.get(changes[0].index) === changes[0].value
  ) {
    throw new Error(`${kind} transaction result does not match sequential updates.`);
  }

  const sequentialDurationMs = median(sequentialDurations);
  const transactionDurationMs = median(transactionDurations);

  return {
    kind,
    updates: UPDATES,
    rounds: sequentialDurations.length,
    sequentialDurationMs,
    transactionDurationMs,
    speedup: sequentialDurationMs / transactionDurationMs,
    checksum: transactionChecksum,
  };
}

function measureRetention(kind, values) {
  let current = createVector(kind, values);
  collectGarbage();
  const before = memory();
  const base = current;
  const snapshots = [];

  for (let index = 0; index < SNAPSHOTS; index += 1) {
    const position = (index * 7_919) % current.length;
    current = current.set(position, SIZE + index);
    snapshots.push(current);
  }

  collectGarbage();
  const retained = memory();
  const retainedDelta = delta(before, retained);

  snapshots.length = 0;
  current = base;
  collectGarbage();
  const released = memory();

  return {
    kind,
    baseline: before,
    afterRetainingSnapshots: retained,
    retainedDelta,
    afterReleasingSnapshots: released,
    releasedDelta: delta(before, released),
  };
}

async function main() {
  const values = Array.from({ length: SIZE }, (_, index) => index);
  const allocationProfiles = [];
  const retentionProfiles = [];
  const transactionProfiles = [];

  for (const kind of ['bplus', 'rrb']) {
    const warm = createVector(kind, values);

    for (let index = 0; index < 1_000; index += 1) {
      warm.set((index * 7_919) % warm.length, SIZE + index);
    }

    for (const value of warm) {
      void value;
    }
  }

  for (const kind of ['bplus', 'rrb']) {
    allocationProfiles.push(await profileAllocations(kind, values));
    transactionProfiles.push(profileTransactions(kind, values));
    retentionProfiles.push(measureRetention(kind, values));
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runtime: process.version,
        platform: `${process.platform}-${process.arch}`,
        configuration: {
          size: SIZE,
          pageSize: 256,
          updates: UPDATES,
          retainedSnapshots: SNAPSHOTS,
          samplingIntervalBytes: SAMPLE_INTERVAL,
          explicitGc: hasGc,
        },
        allocationProfiles,
        transactionProfiles,
        retentionProfiles,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack : String(error);
  process.stderr.write(`Profiling failed: ${message}\n`);
  process.exitCode = 1;
});
