import {
  selectPageCapacity,
  VectorBuilder,
  type PersistentTreeVector,
  type TreeOptions,
  type VectorDraft,
} from './tree.ts';

type RrbNode<T> = RrbLeaf<T> | RrbBranch<T>;

interface RrbLeaf<T> {
  readonly tag: 0;
  readonly values: readonly T[];
  readonly size: number;
  readonly level: 0;
}

interface RrbBranch<T> {
  readonly tag: 1;
  readonly children: readonly RrbNode<T>[];
  /** Cumulative subtree sizes are the relaxation table used for indexed descent. */
  readonly sizes: readonly number[];
  readonly size: number;
  readonly level: number;
}

interface RrbInsert<T> {
  readonly node: RrbNode<T>;
  readonly overflow?: RrbNode<T>;
}

const DEFAULT_BRANCH_FACTOR = 32;

function consumeThenable(value: object): void {
  const then = (value as { then?: unknown }).then;

  if (typeof then === 'function') {
    (
      then as (
        onFulfilled?: (result: unknown) => void,
        onRejected?: (reason: unknown) => void,
      ) => unknown
    ).call(value, undefined, () => undefined);
  }
}

function makeLeaf<T>(values: readonly T[]): RrbLeaf<T> {
  return { tag: 0, values, size: values.length, level: 0 };
}

function makeBranch<T>(children: readonly RrbNode<T>[]): RrbBranch<T> {
  const sizes: number[] = [];
  let size = 0;

  for (const child of children) {
    size += child.size;
    sizes.push(size);
  }

  return {
    tag: 1,
    children,
    sizes,
    size,
    level: (children[0]?.level ?? -1) + 1,
  };
}

function locate<T>(node: RrbBranch<T>, index: number): number {
  let low = 0;
  let high = node.sizes.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((node.sizes[middle] ?? 0) <= index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function prefix<T>(node: RrbBranch<T>, child: number): number {
  return child === 0 ? 0 : (node.sizes[child - 1] ?? 0);
}

function pack<T>(values: readonly T[], pageSize: number, fanout: number): RrbNode<T> {
  if (values.length === 0) {
    return makeLeaf([]);
  }

  let layer: RrbNode<T>[] = [];

  for (let offset = 0; offset < values.length; offset += pageSize) {
    layer.push(makeLeaf(values.slice(offset, Math.min(values.length, offset + pageSize))));
  }

  while (layer.length > 1) {
    const next: RrbNode<T>[] = [];

    for (let offset = 0; offset < layer.length; offset += fanout) {
      next.push(makeBranch(layer.slice(offset, offset + fanout)));
    }

    layer = next;
  }

  return layer[0] ?? makeLeaf([]);
}

function read<T>(root: RrbNode<T>, index: number): T | undefined {
  let node = root;
  let cursor = index;

  while (node.tag === 1) {
    const child = locate(node, cursor);
    cursor -= prefix(node, child);
    node = node.children[child] as RrbNode<T>;
  }

  return node.values[cursor];
}

function write<T>(node: RrbNode<T>, index: number, value: T): RrbNode<T> {
  if (node.tag === 0) {
    if (Object.is(node.values[index], value)) {
      return node;
    }

    const values = node.values.slice() as T[];
    values[index] = value;
    return makeLeaf(values);
  }

  const childIndex = locate(node, index);
  const child = node.children[childIndex] as RrbNode<T>;
  const updated = write(child, index - prefix(node, childIndex), value);

  if (updated === child) {
    return node;
  }

  const children = node.children.slice() as RrbNode<T>[];
  children[childIndex] = updated;
  return makeBranch(children);
}

function lowerBound<T>(updates: readonly (readonly [number, T])[], target: number): number {
  let low = 0;
  let high = updates.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((updates[middle]?.[0] ?? Number.POSITIVE_INFINITY) < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function writeMany<T>(
  node: RrbNode<T>,
  updates: readonly (readonly [number, T])[],
  from: number,
  to: number,
  base = 0,
): RrbNode<T> {
  if (from >= to) {
    return node;
  }

  if (node.tag === 0) {
    let values: T[] | undefined;

    for (let index = from; index < to; index += 1) {
      const update = updates[index];

      if (!update) {
        continue;
      }

      const local = update[0] - base;
      const current = values ? values[local] : node.values[local];

      if (!Object.is(current, update[1])) {
        values ??= node.values.slice() as T[];
        values[local] = update[1];
      }
    }

    return values ? makeLeaf(values) : node;
  }

  let children: RrbNode<T>[] | undefined;
  let offset = base;
  let cursor = from;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index] as RrbNode<T>;
    const nextOffset = offset + child.size;
    const nextCursor = lowerBound(updates, nextOffset);

    if (cursor < nextCursor) {
      const next = writeMany(child, updates, cursor, nextCursor, offset);

      if (next !== child) {
        children ??= node.children.slice() as RrbNode<T>[];
        children[index] = next;
      }
    }

    cursor = nextCursor;
    offset = nextOffset;

    if (cursor >= to) {
      break;
    }
  }

  return children ? makeBranch(children) : node;
}

function insert<T>(
  node: RrbNode<T>,
  index: number,
  value: T,
  pageSize: number,
  fanout: number,
): RrbInsert<T> {
  if (node.tag === 0) {
    const values = node.values.slice() as T[];
    values.splice(index, 0, value);

    if (values.length <= pageSize) {
      return { node: makeLeaf(values) };
    }

    const midpoint = Math.ceil(values.length / 2);
    return {
      node: makeLeaf(values.slice(0, midpoint)),
      overflow: makeLeaf(values.slice(midpoint)),
    };
  }

  const childIndex = index === node.size ? node.children.length - 1 : locate(node, index);
  const child = node.children[childIndex] as RrbNode<T>;
  const localIndex = index - prefix(node, childIndex);
  const result = insert(child, localIndex, value, pageSize, fanout);
  const children = node.children.slice() as RrbNode<T>[];
  children.splice(childIndex, 1, result.node);

  if (result.overflow) {
    children.splice(childIndex + 1, 0, result.overflow);
  }

  if (children.length <= fanout) {
    return { node: makeBranch(children) };
  }

  const midpoint = Math.ceil(children.length / 2);
  return {
    node: makeBranch(children.slice(0, midpoint)),
    overflow: makeBranch(children.slice(midpoint)),
  };
}

function remove<T>(node: RrbNode<T>, index: number): RrbNode<T> | null {
  if (node.tag === 0) {
    const values = node.values.slice() as T[];
    values.splice(index, 1);
    return values.length === 0 ? null : makeLeaf(values);
  }

  const childIndex = locate(node, index);
  const child = node.children[childIndex] as RrbNode<T>;
  const next = remove(child, index - prefix(node, childIndex));
  const children = node.children.slice() as RrbNode<T>[];

  if (next) {
    children[childIndex] = next;
  } else {
    children.splice(childIndex, 1);
  }

  return children.length === 0 ? null : makeBranch(children);
}

function removeRange<T>(node: RrbNode<T>, start: number, end: number): RrbNode<T> | null {
  if (start === 0 && end >= node.size) {
    return null;
  }

  if (node.tag === 0) {
    const values = [...node.values.slice(0, start), ...node.values.slice(end)];
    return values.length === 0 ? null : makeLeaf(values);
  }

  const retained: RrbNode<T>[] = [];
  let offset = 0;

  for (const child of node.children) {
    const childEnd = offset + child.size;

    if (childEnd <= start || offset >= end) {
      retained.push(child);
    } else if (start <= offset && end >= childEnd) {
      // Fully covered subtrees are dropped without visiting their descendants.
    } else {
      const next = removeRange(
        child,
        Math.max(0, start - offset),
        Math.min(child.size, end - offset),
      );

      if (next) {
        retained.push(next);
      }
    }

    offset = childEnd;
  }

  return retained.length === 0 ? null : makeBranch(retained);
}

function collapse<T>(node: RrbNode<T>): RrbNode<T> {
  let root = node;

  while (root.tag === 1 && root.children.length === 1) {
    root = root.children[0] as RrbNode<T>;
  }

  return root;
}

function walk<T>(root: RrbNode<T>): IterableIterator<T> {
  const pending: RrbNode<T>[] = [root];
  let values: readonly T[] | undefined;
  let cursor = 0;

  const iterator: IterableIterator<T> = {
    next(): IteratorResult<T> {
      while (true) {
        if (values && cursor < values.length) {
          const value = values[cursor];
          cursor += 1;
          return { done: false, value: value as T };
        }

        values = undefined;
        const node = pending.pop();

        if (!node) {
          return { done: true, value: undefined };
        }

        if (node.tag === 0) {
          values = node.values;
          cursor = 0;
          continue;
        }

        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          pending.push(node.children[index] as RrbNode<T>);
        }
      }
    },
    [Symbol.iterator]() {
      return this;
    },
  };

  return iterator;
}

function assertRrbNode<T>(
  node: RrbNode<T>,
  isRoot: boolean,
  pageSize: number,
  fanout: number,
): void {
  if (node.tag === 0) {
    if (node.size !== node.values.length || node.size > pageSize || (!isRoot && node.size === 0)) {
      throw new Error('RRB leaf size invariant failed.');
    }

    return;
  }

  if (node.children.length === 0 || node.children.length > fanout) {
    throw new Error('RRB branch fanout invariant failed.');
  }

  let size = 0;
  const level = node.children[0]?.level;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];

    if (!child || child.level !== level) {
      throw new Error('RRB child-level invariant failed.');
    }

    assertRrbNode(child, false, pageSize, fanout);
    size += child.size;

    if (node.sizes[index] !== size) {
      throw new Error('RRB relaxed size-table invariant failed.');
    }
  }

  if (node.size !== size || node.level !== (level ?? -1) + 1) {
    throw new Error('RRB aggregate metadata invariant failed.');
  }
}

function capacity(options: TreeOptions, length: number): number {
  const value =
    options.pageCapacity === undefined || options.pageCapacity === 'adaptive'
      ? selectPageCapacity(length, options.profile)
      : options.pageCapacity;

  if (!Number.isSafeInteger(value) || value < 4) {
    throw new RangeError('pageCapacity must be an integer greater than or equal to 4.');
  }

  return value;
}

export class RrbVectorImpl<T> implements PersistentTreeVector<T> {
  readonly #root: RrbNode<T>;
  readonly #pageSize: number;
  readonly #fanout: number;

  private constructor(root: RrbNode<T>, pageSize: number, fanout: number) {
    this.#root = root;
    this.#pageSize = pageSize;
    this.#fanout = fanout;
  }

  static from<T>(values: readonly T[], options: TreeOptions = {}): RrbVectorImpl<T> {
    const pageSize = capacity(options, values.length);
    const fanout = options.branchFactor ?? DEFAULT_BRANCH_FACTOR;

    if (!Number.isSafeInteger(fanout) || fanout < 4) {
      throw new RangeError('branchFactor must be an integer greater than or equal to 4.');
    }

    return new RrbVectorImpl(pack(values, pageSize, fanout), pageSize, fanout);
  }

  assertValid(): void {
    assertRrbNode(this.#root, true, this.#pageSize, this.#fanout);
  }

  get length(): number {
    return this.#root.size;
  }

  get kind(): 'rrb' {
    return 'rrb';
  }

  get pageCapacity(): number {
    return this.#pageSize;
  }

  get(index: number): T | undefined {
    this.#checkIndex(index);

    return read(this.#root, index);
  }

  set(index: number, value: T): PersistentTreeVector<T> {
    this.#checkIndex(index);
    const root = write(this.#root, index, value);

    return root === this.#root ? this : new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  setMany(
    changes: readonly { readonly index: number; readonly value: T }[],
  ): PersistentTreeVector<T> {
    const updates = new Map<number, T>();

    for (const change of changes) {
      this.#checkIndex(change.index);
      updates.set(change.index, change.value);
    }

    const sorted = [...updates].sort(([left], [right]) => left - right);
    const root = writeMany(this.#root, sorted, 0, sorted.length);

    return root === this.#root ? this : new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  builder(): VectorBuilder<T> {
    return new VectorBuilder(this);
  }

  transact(callback: (draft: VectorDraft<T>) => void): PersistentTreeVector<T> {
    const draft = this.builder();

    try {
      const result = (callback as (value: VectorDraft<T>) => unknown)(draft);

      if (
        result !== null &&
        (typeof result === 'object' || typeof result === 'function') &&
        'then' in result
      ) {
        consumeThenable(result);
        throw new TypeError('ArrayForge transactions must be synchronous.');
      }

      return draft.commit();
    } catch (error) {
      draft.rollback();
      throw error;
    }
  }

  insert(index: number, value: T): PersistentTreeVector<T> {
    this.#checkInsertIndex(index);
    const result = insert(this.#root, index, value, this.#pageSize, this.#fanout);
    const root = result.overflow ? makeBranch([result.node, result.overflow]) : result.node;

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  delete(index: number): PersistentTreeVector<T> {
    this.#checkIndex(index);
    const root = collapse(remove(this.#root, index) ?? makeLeaf([]));

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  deleteRange(start: number, end: number): PersistentTreeVector<T> {
    this.#checkRange(start, end);

    if (start === end) {
      return this;
    }

    const root = collapse(removeRange(this.#root, start, end) ?? makeLeaf([]));

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  snapshot(): PersistentTreeVector<T> {
    return this;
  }

  toArray(): T[] {
    return [...this];
  }

  [Symbol.iterator](): IterableIterator<T> {
    return walk(this.#root);
  }

  #checkIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`Index ${index} is outside a collection of length ${this.length}.`);
    }
  }

  #checkInsertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.length) {
      throw new RangeError(
        `Insertion index ${index} is outside a collection of length ${this.length}.`,
      );
    }
  }

  #checkRange(start: number, end: number): void {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      end > this.length
    ) {
      throw new RangeError(
        `Invalid range [${start}, ${end}) for a collection of length ${this.length}.`,
      );
    }
  }
}

export const RrbVector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): PersistentTreeVector<T> {
    return RrbVectorImpl.from(values, options);
  },
};
