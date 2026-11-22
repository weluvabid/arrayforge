import {
  assertValidProfile,
  createBPlusFromIterable,
  PROFILE,
  TREE,
  VectorBuilder,
  selectPageCapacity,
  type BPlusVector,
  type PageProfile,
  type PersistentTreeVector,
  type RRBVector,
  type TreeKind,
  type TreeOptions,
  type TreeStructureStats,
  type VectorDraft,
} from './tree.ts';

type RrbNode<T> = RrbLeaf<T> | RrbBranch<T>;

function inspectRrb<T>(root: RrbNode<T>): TreeStructureStats {
  const pending: RrbNode<T>[] = [root];
  let nodes = 0;
  let leaves = 0;
  let branches = 0;
  let leafItems = 0;
  let branchChildren = 0;
  let minLeafOccupancy = Number.POSITIVE_INFINITY;
  let maxLeafOccupancy = 0;
  let minBranchOccupancy = Number.POSITIVE_INFINITY;
  let maxBranchOccupancy = 0;

  while (pending.length > 0) {
    const node = pending.pop() as RrbNode<T>;
    nodes += 1;

    if (node.tag === 0) {
      leaves += 1;
      leafItems += node.values.length;
      minLeafOccupancy = Math.min(minLeafOccupancy, node.values.length);
      maxLeafOccupancy = Math.max(maxLeafOccupancy, node.values.length);
      continue;
    }

    branches += 1;
    branchChildren += node.children.length;
    minBranchOccupancy = Math.min(minBranchOccupancy, node.children.length);
    maxBranchOccupancy = Math.max(maxBranchOccupancy, node.children.length);

    for (const child of node.children) {
      pending.push(child);
    }
  }

  return {
    nodes,
    leaves,
    branches,
    height: root.level,
    minLeafOccupancy: leaves === 0 ? 0 : minLeafOccupancy,
    meanLeafOccupancy: leaves === 0 ? 0 : leafItems / leaves,
    maxLeafOccupancy,
    minBranchOccupancy: branches === 0 ? 0 : minBranchOccupancy,
    meanBranchOccupancy: branches === 0 ? 0 : branchChildren / branches,
    maxBranchOccupancy,
  };
}

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
  readonly uniformChildLength: number;
  readonly size: number;
  readonly level: number;
}

interface RrbInsert<T> {
  readonly node: RrbNode<T>;
  readonly overflow?: RrbNode<T>;
}

function insertValue<T>(source: readonly T[], index: number, value: T): T[] {
  const result = new Array<T>(source.length + 1);

  for (let cursor = 0; cursor < index; cursor += 1) {
    result[cursor] = source[cursor] as T;
  }

  result[index] = value;

  for (let cursor = index; cursor < source.length; cursor += 1) {
    result[cursor + 1] = source[cursor] as T;
  }

  return result;
}

function removeValue<T>(source: readonly T[], index: number): T[] {
  const result = new Array<T>(source.length - 1);

  for (let cursor = 0; cursor < index; cursor += 1) {
    result[cursor] = source[cursor] as T;
  }

  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    result[cursor - 1] = source[cursor] as T;
  }

  return result;
}

function replacePair<T>(source: readonly T[], index: number, first: T, second?: T): T[] {
  const result = new Array<T>(source.length - (second === undefined ? 1 : 0));

  for (let cursor = 0; cursor < index; cursor += 1) {
    result[cursor] = source[cursor] as T;
  }

  result[index] = first;
  let target = index + 1;

  if (second !== undefined) {
    result[target] = second;
    target += 1;
  }

  for (let cursor = index + 2; cursor < source.length; cursor += 1) {
    result[target] = source[cursor] as T;
    target += 1;
  }

  return result;
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
  const sizes = new Array<number>(children.length);
  const firstChildSize = (children[0] as RrbNode<T>).size;
  let uniformChildLength = firstChildSize;
  let size = 0;

  for (let index = 0; index < children.length; index += 1) {
    const childSize = (children[index] as RrbNode<T>).size;
    size += childSize;
    sizes[index] = size;

    if (childSize !== firstChildSize) {
      uniformChildLength = 0;
    }
  }

  return {
    tag: 1,
    children,
    sizes,
    uniformChildLength,
    size,
    level: (children[0]?.level ?? -1) + 1,
  };
}

function locate<T>(node: RrbBranch<T>, index: number): number {
  if (node.uniformChildLength > 0) {
    return Math.floor(index / node.uniformChildLength);
  }

  let low = 0;
  let high = node.sizes.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((node.sizes[middle] as number) <= index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function prefix<T>(node: RrbBranch<T>, child: number): number {
  if (child === 0) {
    return 0;
  }

  return node.uniformChildLength > 0
    ? child * node.uniformChildLength
    : (node.sizes[child - 1] as number);
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

function packIterable<T>(values: Iterable<T>, pageSize: number, fanout: number): RrbNode<T> {
  let layer: RrbNode<T>[] = [];
  let page: T[] = [];

  for (const value of values) {
    page.push(value);

    if (page.length === pageSize) {
      layer.push(makeLeaf(page));
      page = [];
    }
  }

  if (page.length > 0 || layer.length === 0) {
    layer.push(makeLeaf(page));
  }

  while (layer.length > 1) {
    const next: RrbNode<T>[] = [];

    for (let offset = 0; offset < layer.length; offset += fanout) {
      next.push(makeBranch(layer.slice(offset, offset + fanout)));
    }

    layer = next;
  }

  return layer[0] as RrbNode<T>;
}

function normalizeSliceIndex(index: number, length: number): number {
  if (Number.isNaN(index)) {
    return 0;
  }

  if (!Number.isFinite(index)) {
    return index < 0 ? 0 : length;
  }

  const integer = Math.trunc(index);

  return integer < 0 ? Math.max(length + integer, 0) : Math.min(integer, length);
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

    if ((updates[middle] as readonly [number, T])[0] < target) {
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
    if (node.values.length < pageSize) {
      return { node: makeLeaf(insertValue(node.values, index, value)) };
    }

    const totalLength = node.values.length + 1;
    const midpoint = Math.ceil(totalLength / 2);
    const left = new Array<T>(midpoint);
    const right = new Array<T>(totalLength - midpoint);

    for (let target = 0; target < totalLength; target += 1) {
      const item = target === index ? value : node.values[target < index ? target : target - 1];

      if (target < midpoint) {
        left[target] = item as T;
      } else {
        right[target - midpoint] = item as T;
      }
    }

    return { node: makeLeaf(left), overflow: makeLeaf(right) };
  }

  const childIndex = index === node.size ? node.children.length - 1 : locate(node, index);
  const child = node.children[childIndex] as RrbNode<T>;
  const localIndex = index - prefix(node, childIndex);
  const result = insert(child, localIndex, value, pageSize, fanout);
  const totalLength = node.children.length + (result.overflow ? 1 : 0);
  const midpoint = Math.ceil(totalLength / 2);
  const left = new Array<RrbNode<T>>(totalLength <= fanout ? totalLength : midpoint);
  const right = totalLength <= fanout ? undefined : new Array<RrbNode<T>>(totalLength - midpoint);

  for (let target = 0; target < totalLength; target += 1) {
    let next: RrbNode<T>;

    if (target < childIndex) {
      next = node.children[target] as RrbNode<T>;
    } else if (target === childIndex) {
      next = result.node;
    } else if (result.overflow && target === childIndex + 1) {
      next = result.overflow;
    } else {
      next = node.children[target - (result.overflow ? 1 : 0)] as RrbNode<T>;
    }

    if (target < left.length) {
      left[target] = next;
    } else {
      (right as RrbNode<T>[])[target - midpoint] = next;
    }
  }

  return right
    ? { node: makeBranch(left), overflow: makeBranch(right) }
    : { node: makeBranch(left) };
}

function rebalanceChildren<T>(
  children: RrbNode<T>[],
  index: number,
  pageSize: number,
  fanout: number,
): RrbNode<T>[] {
  const current = children[index];

  if (!current || children.length < 2) {
    return children;
  }

  const minimum = current.tag === 0 ? Math.ceil(pageSize / 2) : Math.ceil(fanout / 2);
  const occupancy = current.tag === 0 ? current.values.length : current.children.length;

  if (occupancy >= minimum) {
    return children;
  }

  const leftIndex = index > 0 ? index - 1 : index;
  const left = children[leftIndex];
  const right = children[leftIndex + 1];

  if (!left || !right || left.tag !== right.tag || left.level !== right.level) {
    return children;
  }

  if (left.tag === 0 && right.tag === 0) {
    const total = left.values.length + right.values.length;
    const combined = new Array<T>(total);
    let offset = 0;

    for (const value of left.values) {
      combined[offset] = value;
      offset += 1;
    }

    for (const value of right.values) {
      combined[offset] = value;
      offset += 1;
    }

    if (total <= pageSize) {
      return replacePair(children, leftIndex, makeLeaf(combined));
    }

    const midpoint = Math.ceil(total / 2);
    return replacePair(
      children,
      leftIndex,
      makeLeaf(combined.slice(0, midpoint)),
      makeLeaf(combined.slice(midpoint)),
    );
  }

  if (left.tag === 1 && right.tag === 1) {
    const total = left.children.length + right.children.length;
    const combined = new Array<RrbNode<T>>(total);
    let offset = 0;

    for (const child of left.children) {
      combined[offset] = child;
      offset += 1;
    }

    for (const child of right.children) {
      combined[offset] = child;
      offset += 1;
    }

    if (total <= fanout) {
      return replacePair(children, leftIndex, makeBranch(combined));
    }

    const midpoint = Math.ceil(total / 2);
    return replacePair(
      children,
      leftIndex,
      makeBranch(combined.slice(0, midpoint)),
      makeBranch(combined.slice(midpoint)),
    );
  }

  return children;
}

function remove<T>(
  node: RrbNode<T>,
  index: number,
  pageSize: number,
  fanout: number,
): RrbNode<T> | null {
  if (node.tag === 0) {
    return node.values.length === 1 ? null : makeLeaf(removeValue(node.values, index));
  }

  const childIndex = locate(node, index);
  const child = node.children[childIndex] as RrbNode<T>;
  const next = remove(child, index - prefix(node, childIndex), pageSize, fanout);
  const children = new Array<RrbNode<T>>(node.children.length - (next ? 0 : 1));
  let target = 0;

  for (let childIndexCursor = 0; childIndexCursor < node.children.length; childIndexCursor += 1) {
    if (childIndexCursor === childIndex) {
      if (next) {
        children[target] = next;
        target += 1;
      }

      continue;
    }

    children[target] = node.children[childIndexCursor] as RrbNode<T>;
    target += 1;
  }

  if (children.length === 0) {
    return null;
  }

  const balanced = rebalanceChildren(
    children,
    Math.min(childIndex, children.length - 1),
    pageSize,
    fanout,
  );

  return makeBranch(balanced);
}

function removeRange<T>(
  node: RrbNode<T>,
  start: number,
  end: number,
  pageSize: number,
  fanout: number,
): RrbNode<T> | null {
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
        pageSize,
        fanout,
      );

      if (next) {
        retained.push(next);
      }
    }

    offset = childEnd;
  }

  if (retained.length === 0) {
    return null;
  }

  let balanced = retained;
  let index = 0;

  while (index < balanced.length) {
    const previousLength = balanced.length;
    balanced = rebalanceChildren(balanced, index, pageSize, fanout);

    if (balanced.length < previousLength) {
      index = Math.max(0, index - 1);
    } else {
      index += 1;
    }
  }

  return makeBranch(balanced);
}

function collapse<T>(node: RrbNode<T>): RrbNode<T> {
  let root = node;

  while (root.tag === 1 && root.children.length === 1) {
    root = root.children[0] as RrbNode<T>;
  }

  return root;
}

function sliceNode<T>(node: RrbNode<T>, start: number, end: number): RrbNode<T> | null {
  if (start <= 0 && end >= node.size) {
    return node;
  }

  if (start >= end) {
    return null;
  }

  if (node.tag === 0) {
    const values = node.values.slice(Math.max(0, start), Math.min(node.size, end));

    return values.length === 0 ? null : makeLeaf(values);
  }

  const children: RrbNode<T>[] = [];
  let offset = 0;

  for (const child of node.children) {
    const childEnd = offset + child.size;

    if (childEnd > start && offset < end) {
      if (start <= offset && end >= childEnd) {
        children.push(child);
      } else {
        const updated = sliceNode(
          child,
          Math.max(0, start - offset),
          Math.min(child.size, end - offset),
        );

        if (updated) {
          children.push(updated);
        }
      }
    }

    offset = childEnd;
  }

  return children.length === 0 ? null : makeBranch(children);
}

function packBranches<T>(children: RrbNode<T>[], fanout: number): RrbInsert<T> {
  if (children.length <= fanout) {
    return { node: makeBranch(children) };
  }

  const midpoint = Math.ceil(children.length / 2);

  return {
    node: makeBranch(children.slice(0, midpoint)),
    overflow: makeBranch(children.slice(midpoint)),
  };
}

function joinNodes<T>(
  left: RrbNode<T>,
  right: RrbNode<T>,
  pageSize: number,
  fanout: number,
): RrbInsert<T> {
  if (left.level === 0 && right.level === 0) {
    const leftValues = (left as RrbLeaf<T>).values;
    const rightValues = (right as RrbLeaf<T>).values;
    const length = leftValues.length + rightValues.length;
    const midpoint = Math.ceil(length / 2);

    if (length <= pageSize) {
      const values = new Array<T>(length);

      for (let index = 0; index < leftValues.length; index += 1) {
        values[index] = leftValues[index] as T;
      }

      for (let index = 0; index < rightValues.length; index += 1) {
        values[leftValues.length + index] = rightValues[index] as T;
      }

      return { node: makeLeaf(values) };
    }

    const first = new Array<T>(midpoint);
    const second = new Array<T>(length - midpoint);

    for (let index = 0; index < midpoint; index += 1) {
      first[index] =
        index < leftValues.length
          ? (leftValues[index] as T)
          : (rightValues[index - leftValues.length] as T);
    }

    for (let index = midpoint; index < length; index += 1) {
      const target = index - midpoint;
      second[target] =
        index < leftValues.length
          ? (leftValues[index] as T)
          : (rightValues[index - leftValues.length] as T);
    }

    return { node: makeLeaf(first), overflow: makeLeaf(second) };
  }

  if (left.level === right.level) {
    const leftBranch = left as RrbBranch<T>;
    const rightBranch = right as RrbBranch<T>;
    const childJoin = joinNodes(
      leftBranch.children[leftBranch.children.length - 1] as RrbNode<T>,
      rightBranch.children[0] as RrbNode<T>,
      pageSize,
      fanout,
    );
    const childJoinCount = childJoin.overflow ? 2 : 1;
    const children = new Array<RrbNode<T>>(
      leftBranch.children.length - 1 + childJoinCount + rightBranch.children.length - 1,
    );
    let target = 0;

    for (let index = 0; index < leftBranch.children.length - 1; index += 1) {
      children[target] = leftBranch.children[index] as RrbNode<T>;
      target += 1;
    }

    children[target] = childJoin.node;
    target += 1;

    if (childJoin.overflow) {
      children[target] = childJoin.overflow;
      target += 1;
    }

    for (let index = 1; index < rightBranch.children.length; index += 1) {
      children[target] = rightBranch.children[index] as RrbNode<T>;
      target += 1;
    }

    return packBranches(children, fanout);
  }

  if (left.level > right.level) {
    const leftBranch = left as RrbBranch<T>;
    const lastIndex = leftBranch.children.length - 1;
    const childJoin = joinNodes(
      leftBranch.children[lastIndex] as RrbNode<T>,
      right,
      pageSize,
      fanout,
    );
    const childJoinCount = childJoin.overflow ? 2 : 1;
    const children = new Array<RrbNode<T>>(lastIndex + childJoinCount);

    for (let index = 0; index < lastIndex; index += 1) {
      children[index] = leftBranch.children[index] as RrbNode<T>;
    }

    children[lastIndex] = childJoin.node;

    if (childJoin.overflow) {
      children[lastIndex + 1] = childJoin.overflow;
    }

    return packBranches(children, fanout);
  }

  const rightBranch = right as RrbBranch<T>;
  const childJoin = joinNodes(left, rightBranch.children[0] as RrbNode<T>, pageSize, fanout);
  const childJoinCount = childJoin.overflow ? 2 : 1;
  const children = new Array<RrbNode<T>>(childJoinCount + rightBranch.children.length - 1);
  let target = 0;

  children[target] = childJoin.node;
  target += 1;

  if (childJoin.overflow) {
    children[target] = childJoin.overflow;
    target += 1;
  }

  for (let index = 1; index < rightBranch.children.length; index += 1) {
    children[target] = rightBranch.children[index] as RrbNode<T>;
    target += 1;
  }

  return packBranches(children, fanout);
}

function forEachNode<T>(
  node: RrbNode<T>,
  callback: (value: T, index: number) => void,
  offset: number,
): void {
  if (node.tag === 0) {
    const values = node.values;

    for (let index = 0; index < values.length; index += 1) {
      callback(values[index] as T, offset + index);
    }

    return;
  }

  let childOffset = offset;
  const children = node.children;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as RrbNode<T>;
    forEachNode(child, callback, childOffset);
    childOffset += child.size;
  }
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
  assertValidProfile(options.profile);

  const value = options.pageSize ?? selectPageCapacity(length, options.profile);

  if (!Number.isSafeInteger(value) || value < 4) {
    throw new RangeError('pageSize must be an integer greater than or equal to 4.');
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

  static fromIterable<T>(
    values: Iterable<T>,
    options: TreeOptions,
    length: number,
  ): RrbVectorImpl<T> {
    const pageSize = capacity(options, length);
    const fanout = options.branchFactor ?? DEFAULT_BRANCH_FACTOR;

    if (!Number.isSafeInteger(fanout) || fanout < 4) {
      throw new RangeError('branchFactor must be an integer greater than or equal to 4.');
    }

    return new RrbVectorImpl(packIterable(values, pageSize, fanout), pageSize, fanout);
  }

  assertValid(): void {
    assertRrbNode(this.#root, true, this.#pageSize, this.#fanout);
  }

  inspectStructure(): TreeStructureStats {
    return inspectRrb(this.#root);
  }

  get length(): number {
    return this.#root.size;
  }

  get kind(): typeof TREE.RRB {
    return TREE.RRB;
  }

  get pageSize(): number {
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
    changes: readonly { readonly index: number; readonly value: T }[] | Map<number, T>,
  ): PersistentTreeVector<T> {
    let updates: Map<number, T>;

    if (changes instanceof Map) {
      updates = changes;

      for (const index of updates.keys()) {
        this.#checkIndex(index);
      }
    } else {
      updates = new Map<number, T>();

      for (const change of changes) {
        this.#checkIndex(change.index);
        updates.set(change.index, change.value);
      }
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
    const root = collapse(remove(this.#root, index, this.#pageSize, this.#fanout) ?? makeLeaf([]));

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  deleteRange(start: number, end: number): PersistentTreeVector<T> {
    this.#checkRange(start, end);

    if (start === end) {
      return this;
    }

    const root = collapse(
      removeRange(this.#root, start, end, this.#pageSize, this.#fanout) ?? makeLeaf([]),
    );

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  slice(start = 0, end = this.length): PersistentTreeVector<T> {
    const normalizedStart = normalizeSliceIndex(start, this.length);
    const normalizedEnd = Math.max(normalizedStart, normalizeSliceIndex(end, this.length));

    if (normalizedStart === 0 && normalizedEnd === this.length) {
      return this;
    }

    if (normalizedStart === normalizedEnd) {
      return new RrbVectorImpl(makeLeaf([]), this.#pageSize, this.#fanout);
    }

    const root = collapse(sliceNode(this.#root, normalizedStart, normalizedEnd) ?? makeLeaf([]));

    return new RrbVectorImpl(root, this.#pageSize, this.#fanout);
  }

  splice(start: number, deleteCount: number, ...items: T[]): PersistentTreeVector<T> {
    const normalizedStart = normalizeSliceIndex(start, this.length);
    const normalizedDeleteCount = Number.isNaN(deleteCount)
      ? 0
      : Math.min(Math.max(Math.trunc(deleteCount), 0), this.length - normalizedStart);
    const end = normalizedStart + normalizedDeleteCount;

    if (normalizedDeleteCount === 0 && items.length === 0) {
      return this;
    }

    const prefix = this.slice(0, normalizedStart);
    const suffix = this.slice(end, this.length);
    const withInserted = items.length === 0 ? prefix : prefix.concat(items);

    return withInserted.concat(suffix);
  }

  concat(other: Iterable<T>): PersistentTreeVector<T> {
    const right =
      other instanceof RrbVectorImpl &&
      other.#pageSize === this.#pageSize &&
      other.#fanout === this.#fanout
        ? other
        : RrbVectorImpl.fromIterable(
            other,
            { pageSize: this.#pageSize, branchFactor: this.#fanout },
            0,
          );

    if (right.length === 0) {
      return this;
    }

    if (this.length === 0) {
      return new RrbVectorImpl(right.#root, this.#pageSize, this.#fanout);
    }

    const joined = joinNodes(this.#root, right.#root, this.#pageSize, this.#fanout);
    const root = joined.overflow ? makeBranch([joined.node, joined.overflow]) : joined.node;

    return new RrbVectorImpl(collapse(root), this.#pageSize, this.#fanout);
  }

  convertTo(tree: typeof TREE.B_PLUS, options?: TreeOptions): BPlusVector<T>;
  convertTo(tree: typeof TREE.RRB, options?: TreeOptions): RRBVector<T>;
  convertTo(tree: TreeKind, options?: TreeOptions): PersistentTreeVector<T>;
  convertTo(tree: TreeKind, options: TreeOptions = {}): PersistentTreeVector<T> {
    if (tree !== TREE.B_PLUS && tree !== TREE.RRB) {
      throw new TypeError(`Unknown tree implementation: ${String(tree)}.`);
    }

    if (tree === TREE.B_PLUS) {
      return this.toBPlus(options);
    }

    return this.toRRB(options);
  }

  toBPlus(options: TreeOptions = {}): BPlusVector<T> {
    return createBPlusFromIterable(
      this,
      {
        ...options,
        pageSize:
          options.pageSize ??
          (options.profile ? selectPageCapacity(this.length, options.profile) : this.#pageSize),
        branchFactor: options.branchFactor ?? this.#fanout,
      },
      this.length,
    );
  }

  toRRB(options: TreeOptions = {}): RRBVector<T> {
    const targetCapacity = options.pageSize;
    const resolvedCapacity =
      targetCapacity ??
      (options.profile ? selectPageCapacity(this.length, options.profile) : this.#pageSize);
    capacity({ ...options, pageSize: resolvedCapacity }, this.length);
    const targetFanout = options.branchFactor ?? this.#fanout;

    if (resolvedCapacity === this.#pageSize && targetFanout === this.#fanout) {
      return this;
    }

    return RrbVectorImpl.fromIterable(
      this,
      { ...options, pageSize: resolvedCapacity, branchFactor: targetFanout },
      this.length,
    );
  }

  withProfile(profile: PageProfile): PersistentTreeVector<T> {
    const tree = profile === PROFILE.MUTATION_HEAVY ? TREE.B_PLUS : TREE.RRB;

    return this.convertTo(tree, { profile });
  }

  snapshot(): PersistentTreeVector<T> {
    return this;
  }

  toArray(): T[] {
    return [...this];
  }

  forEach(callback: (value: T, index: number) => void): void {
    forEachNode(this.#root, callback, 0);
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

export function createRrbFromIterable<T>(
  values: Iterable<T>,
  options: TreeOptions,
  length: number,
): RRBVector<T> {
  return RrbVectorImpl.fromIterable(values, options, length);
}

export const RrbVector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): RRBVector<T> {
    return RrbVectorImpl.from(values, options);
  },
};
