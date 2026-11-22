export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function createValues(size: number): number[] {
  const values = new Array<number>(size);

  for (let index = 0; index < size; index += 1) {
    values[index] = index;
  }

  return values;
}

export function createChanges(size: number, count: number, seed: number) {
  const random = createRandom(seed);
  const changes = new Array<{ index: number; value: number }>(count);

  for (let index = 0; index < count; index += 1) {
    changes[index] = {
      index: Math.floor(random() * size),
      value: size + index,
    };
  }

  return changes;
}
