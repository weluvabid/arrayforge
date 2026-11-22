import { RrbVector, createRrbFromIterable } from './rrb.ts';

export const PROFILE = Object.freeze({
  BALANCED: 'balanced',
  READ_HEAVY: 'read-heavy',
  MUTATION_HEAVY: 'mutation-heavy',
  BATCH_HEAVY: 'batch-heavy',
} as const);

export const TREE = Object.freeze({
  AUTO: 'auto',
  B_PLUS: 'bplus',
  RRB: 'rrb',
} as const);

export const PAGE_SIZE = Object.freeze({
  SMALL: 256,
  MEDIUM: 512,
  LARGE: 1024,
} as const);

export type TreeKind = typeof TREE.B_PLUS | typeof TREE.RRB;
export type TreeSelection = TreeKind | typeof TREE.AUTO;
export type Profile = (typeof PROFILE)[keyof typeof PROFILE];
export type PageProfile = Profile;
export type PageSize = (typeof PAGE_SIZE)[keyof typeof PAGE_SIZE] | number;

export interface TreeStructureStats {
  readonly nodes: number;
  readonly leaves: number;
  readonly branches: number;
  readonly height: number;
  readonly minLeafOccupancy: number;
  readonly meanLeafOccupancy: number;
  readonly maxLeafOccupancy: number;
  readonly minBranchOccupancy: number;
  readonly meanBranchOccupancy: number;
  readonly maxBranchOccupancy: number;
}

export interface TreeOptions {
  readonly pageSize?: PageSize;
  readonly profile?: PageProfile;
  readonly branchFactor?: number;
}

export interface VectorOptions extends TreeOptions {
  readonly tree?: TreeSelection;
}

export function assertValidProfile(profile: PageProfile | undefined): void {
  if (
    profile !== undefined &&
    profile !== PROFILE.BALANCED &&
    profile !== PROFILE.READ_HEAVY &&
    profile !== PROFILE.MUTATION_HEAVY &&
    profile !== PROFILE.BATCH_HEAVY
  ) {
    throw new TypeError(`Unknown workload profile: ${String(profile)}.`);
  }
}

export function selectPageCapacity(
  length: number,
  profile: PageProfile = PROFILE.BALANCED,
): number {
  assertValidProfile(profile);

  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('Collection length must be a non-negative safe integer.');
  }

  if (profile === PROFILE.READ_HEAVY) {
    return length >= 1_000_000 ? PAGE_SIZE.LARGE : PAGE_SIZE.MEDIUM;
  }

  return PAGE_SIZE.SMALL;
}

function resolvePageCapacity(options: TreeOptions, length: number): number {
  assertValidProfile(options.profile);

  const capacity = options.pageSize ?? selectPageCapacity(length, options.profile);

  validateCapacity(capacity, 'pageSize');

  return capacity;
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

interface LeafNode<T> {
  readonly kind: 'leaf';
  readonly items: readonly T[];
  readonly length: number;
  readonly height: 0;
}

interface BranchNode<T> {
  readonly kind: 'branch';
  readonly children: readonly TreeNode<T>[];
  readonly sizes: readonly number[];
  readonly uniformChildLength: number;
  readonly length: number;
  readonly height: number;
}

type TreeNode<T> = LeafNode<T> | BranchNode<T>;

function inspectTree<T>(root: TreeNode<T>): TreeStructureStats {
  const pending: TreeNode<T>[] = [root];
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
    const node = pending.pop() as TreeNode<T>;
    nodes += 1;

    if (node.kind === 'leaf') {
      leaves += 1;
      leafItems += node.items.length;
      minLeafOccupancy = Math.min(minLeafOccupancy, node.items.length);
      maxLeafOccupancy = Math.max(maxLeafOccupancy, node.items.length);
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
    height: root.height,
    minLeafOccupancy: leaves === 0 ? 0 : minLeafOccupancy,
    meanLeafOccupancy: leaves === 0 ? 0 : leafItems / leaves,
    maxLeafOccupancy,
    minBranchOccupancy: branches === 0 ? 0 : minBranchOccupancy,
    meanBranchOccupancy: branches === 0 ? 0 : branchChildren / branches,
    maxBranchOccupancy,
  };
}

interface InsertResult<T> {
  readonly left: TreeNode<T>;
  readonly right?: TreeNode<T>;
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

function leaf<T>(items: readonly T[]): LeafNode<T> {
  return {
    kind: 'leaf',
    items,
    length: items.length,
    height: 0,
  };
}

function branch<T>(children: readonly TreeNode<T>[]): BranchNode<T> {
  const sizes = new Array<number>(children.length);
  const firstChildLength = (children[0] as TreeNode<T>).length;
  let uniformChildLength = firstChildLength;
  let length = 0;

  for (let index = 0; index < children.length; index += 1) {
    const childLength = (children[index] as TreeNode<T>).length;
    length += childLength;
    sizes[index] = length;

    if (childLength !== firstChildLength) {
      uniformChildLength = 0;
    }
  }

  return {
    kind: 'branch',
    children,
    sizes,
    uniformChildLength,
    length,
    height: (children[0] as TreeNode<T>).height + 1,
  };
}

function childIndexForRead<T>(node: BranchNode<T>, index: number): number {
  if (node.uniformChildLength > 0) {
    return Math.floor(index / node.uniformChildLength);
  }

  let low = 0;
  let high = node.sizes.length - 1;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((node.sizes[middle] as number) > index) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
}

function childIndexForInsert<T>(node: BranchNode<T>, index: number): number {
  if (index === node.length) {
    return node.children.length - 1;
  }

  return childIndexForRead(node, index);
}

function childStart<T>(node: BranchNode<T>, childIndex: number): number {
  if (childIndex === 0) {
    return 0;
  }

  return node.uniformChildLength > 0
    ? childIndex * node.uniformChildLength
    : (node.sizes[childIndex - 1] as number);
}

function buildTree<T>(
  values: readonly T[],
  pageCapacity: number,
  branchFactor: number,
): TreeNode<T> {
  if (values.length === 0) {
    return leaf([]);
  }

  const pageCount = Math.ceil(values.length / pageCapacity);
  const basePageLength = Math.floor(values.length / pageCount);
  const extraPages = values.length % pageCount;
  let offset = 0;
  let level: TreeNode<T>[] = [];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageLength = basePageLength + (pageIndex < extraPages ? 1 : 0);
    level.push(leaf(values.slice(offset, offset + pageLength)));
    offset += pageLength;
  }

  while (level.length > branchFactor) {
    const groupCount = Math.ceil(level.length / branchFactor);
    const baseGroupLength = Math.floor(level.length / groupCount);
    const extraGroups = level.length % groupCount;
    const next: TreeNode<T>[] = [];
    let childOffset = 0;

    for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
      const groupLength = baseGroupLength + (groupIndex < extraGroups ? 1 : 0);
      next.push(branch(level.slice(childOffset, childOffset + groupLength)));
      childOffset += groupLength;
    }

    level = next;
  }

  if (level.length > 1) {
    level = [branch(level)];
  }

  return level[0] ?? leaf([]);
}

function buildTreeFromIterable<T>(
  values: Iterable<T>,
  pageCapacity: number,
  branchFactor: number,
): TreeNode<T> {
  const pages: T[][] = [];
  let page: T[] = [];

  for (const value of values) {
    page.push(value);

    if (page.length === pageCapacity) {
      pages.push(page);
      page = [];
    }
  }

  if (page.length > 0 || pages.length === 0) {
    pages.push(page);
  }

  const last = pages[pages.length - 1];
  const previous = pages[pages.length - 2];

  if (last && previous && last.length < Math.ceil(pageCapacity / 2)) {
    const totalLength = previous.length + last.length;
    const midpoint = Math.ceil(totalLength / 2);
    const left = previous.slice(0, midpoint);
    const right = new Array<T>(totalLength - midpoint);
    let target = 0;

    for (let index = midpoint; index < previous.length; index += 1) {
      right[target] = previous[index] as T;
      target += 1;
    }

    for (let index = 0; index < last.length; index += 1) {
      right[target] = last[index] as T;
      target += 1;
    }

    pages.splice(pages.length - 2, 2, left, right);
  }

  let level: TreeNode<T>[] = pages.map((items) => leaf(items));

  while (level.length > branchFactor) {
    const groupCount = Math.ceil(level.length / branchFactor);
    const baseGroupLength = Math.floor(level.length / groupCount);
    const extraGroups = level.length % groupCount;
    const next: TreeNode<T>[] = [];
    let offset = 0;

    for (let index = 0; index < groupCount; index += 1) {
      const count = baseGroupLength + (index < extraGroups ? 1 : 0);
      next.push(branch(level.slice(offset, offset + count)));
      offset += count;
    }

    level = next;
  }

  return level.length === 1 ? (level[0] as TreeNode<T>) : branch(level);
}

function* sliceValues<T>(values: Iterable<T>, start: number, end: number): IterableIterator<T> {
  let index = 0;

  for (const value of values) {
    if (index >= end) {
      return;
    }

    if (index >= start) {
      yield value;
    }

    index += 1;
  }
}

function* spliceValues<T>(
  values: Iterable<T>,
  start: number,
  end: number,
  inserted: readonly T[],
): IterableIterator<T> {
  let index = 0;

  for (const value of values) {
    if (index === start) {
      yield* inserted;
    }

    if (index < start || index >= end) {
      yield value;
    }

    index += 1;
  }

  if (start === index) {
    yield* inserted;
  }
}

function* concatValues<T>(values: Iterable<T>, other: Iterable<T>): IterableIterator<T> {
  yield* values;
  yield* other;
}

function getNode<T>(root: TreeNode<T>, index: number): T | undefined {
  let node = root;
  let offset = index;

  while (node.kind === 'branch') {
    const selected = childIndexForRead(node, offset);
    offset -= childStart(node, selected);
    node = node.children[selected] as TreeNode<T>;
  }

  return node.items[offset];
}

function setNode<T>(node: TreeNode<T>, index: number, value: T): TreeNode<T> {
  if (node.kind === 'leaf') {
    if (Object.is(node.items[index], value)) {
      return node;
    }

    const items = node.items.slice();
    (items as T[])[index] = value;

    return leaf(items);
  }

  const selected = childIndexForRead(node, index);
  const previous = node.children[selected] as TreeNode<T>;
  const updated = setNode(previous, index - childStart(node, selected), value);

  if (updated === previous) {
    return node;
  }

  const children = node.children.slice() as TreeNode<T>[];
  children[selected] = updated;

  return branch(children);
}

function lowerBound<T>(changes: readonly (readonly [number, T])[], target: number): number {
  let low = 0;
  let high = changes.length;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((changes[middle] as readonly [number, T])[0] < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

function setManyNode<T>(
  node: TreeNode<T>,
  changes: readonly (readonly [number, T])[],
  from: number,
  to: number,
  offset = 0,
): TreeNode<T> {
  if (from >= to) {
    return node;
  }

  if (node.kind === 'leaf') {
    let items: T[] | undefined;

    for (let index = from; index < to; index += 1) {
      const change = changes[index];

      if (!change) {
        continue;
      }

      const local = change[0] - offset;
      const current = items ? items[local] : node.items[local];

      if (!Object.is(current, change[1])) {
        items ??= node.items.slice() as T[];
        items[local] = change[1];
      }
    }

    return items ? leaf(items) : node;
  }

  let children: TreeNode<T>[] | undefined;
  let childOffset = offset;
  let cursor = from;

  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const child = node.children[childIndex] as TreeNode<T>;
    const childEnd = childOffset + child.length;
    const nextCursor = lowerBound(changes, childEnd);

    if (cursor < nextCursor) {
      const updated = setManyNode(child, changes, cursor, nextCursor, childOffset);

      if (updated !== child) {
        children ??= node.children.slice() as TreeNode<T>[];
        children[childIndex] = updated;
      }
    }

    cursor = nextCursor;
    childOffset = childEnd;

    if (cursor >= to) {
      break;
    }
  }

  return children ? branch(children) : node;
}

function insertNode<T>(
  node: TreeNode<T>,
  index: number,
  value: T,
  pageCapacity: number,
  branchFactor: number,
): InsertResult<T> {
  if (node.kind === 'leaf') {
    if (node.items.length < pageCapacity) {
      return { left: leaf(insertValue(node.items, index, value)) };
    }

    const totalLength = node.items.length + 1;
    const midpoint = Math.ceil(totalLength / 2);
    const left = new Array<T>(midpoint);
    const right = new Array<T>(totalLength - midpoint);

    for (let target = 0; target < totalLength; target += 1) {
      const item = target === index ? value : node.items[target < index ? target : target - 1];

      if (target < midpoint) {
        left[target] = item as T;
      } else {
        right[target - midpoint] = item as T;
      }
    }

    return { left: leaf(left), right: leaf(right) };
  }

  const selected = childIndexForInsert(node, index);
  const start = childStart(node, selected);
  const childResult = insertNode(
    node.children[selected] as TreeNode<T>,
    index - start,
    value,
    pageCapacity,
    branchFactor,
  );
  const totalLength = node.children.length + (childResult.right ? 1 : 0);
  const midpoint = Math.ceil(totalLength / 2);
  const left = new Array<TreeNode<T>>(totalLength <= branchFactor ? totalLength : midpoint);
  const right =
    totalLength <= branchFactor ? undefined : new Array<TreeNode<T>>(totalLength - midpoint);

  for (let target = 0; target < totalLength; target += 1) {
    let child: TreeNode<T>;

    if (target < selected) {
      child = node.children[target] as TreeNode<T>;
    } else if (target === selected) {
      child = childResult.left;
    } else if (childResult.right && target === selected + 1) {
      child = childResult.right;
    } else {
      child = node.children[target - (childResult.right ? 1 : 0)] as TreeNode<T>;
    }

    if (target < left.length) {
      left[target] = child;
    } else {
      (right as TreeNode<T>[])[target - midpoint] = child;
    }
  }

  return right ? { left: branch(left), right: branch(right) } : { left: branch(left) };
}

function combineSiblings<T>(
  left: TreeNode<T>,
  right: TreeNode<T>,
  pageCapacity: number,
  branchFactor: number,
): readonly [TreeNode<T>, TreeNode<T>?] {
  if (left.kind === 'leaf' && right.kind === 'leaf') {
    const totalLength = left.items.length + right.items.length;
    const midpoint = Math.ceil(totalLength / 2);
    const first = new Array<T>(totalLength <= pageCapacity ? totalLength : midpoint);
    const second = totalLength <= pageCapacity ? undefined : new Array<T>(totalLength - midpoint);

    for (let index = 0; index < totalLength; index += 1) {
      const value =
        index < left.items.length
          ? (left.items[index] as T)
          : (right.items[index - left.items.length] as T);

      if (index < first.length) {
        first[index] = value;
      } else {
        (second as T[])[index - midpoint] = value;
      }
    }

    return second ? [leaf(first), leaf(second)] : [leaf(first)];
  }

  if (left.kind === 'branch' && right.kind === 'branch') {
    const totalLength = left.children.length + right.children.length;
    const midpoint = Math.ceil(totalLength / 2);
    const first = new Array<TreeNode<T>>(totalLength <= branchFactor ? totalLength : midpoint);
    const second =
      totalLength <= branchFactor ? undefined : new Array<TreeNode<T>>(totalLength - midpoint);

    for (let index = 0; index < totalLength; index += 1) {
      const child =
        index < left.children.length
          ? (left.children[index] as TreeNode<T>)
          : (right.children[index - left.children.length] as TreeNode<T>);

      if (index < first.length) {
        first[index] = child;
      } else {
        (second as TreeNode<T>[])[index - midpoint] = child;
      }
    }

    return second ? [branch(first), branch(second)] : [branch(first)];
  }

  return [left, right];
}

function rebalanceChild<T>(
  children: TreeNode<T>[],
  index: number,
  pageCapacity: number,
  branchFactor: number,
): TreeNode<T>[] {
  const current = children[index];

  if (!current || children.length < 2) {
    return children;
  }

  const minimum =
    current.kind === 'leaf' ? Math.ceil(pageCapacity / 2) : Math.ceil(branchFactor / 2);
  const occupancy = current.kind === 'leaf' ? current.items.length : current.children.length;

  if (occupancy >= minimum) {
    return children;
  }

  const leftIndex = index > 0 ? index - 1 : index;
  const rightIndex = leftIndex + 1;
  const left = children[leftIndex];
  const right = children[rightIndex];

  if (!left || !right) {
    return children;
  }

  const [first, second] = combineSiblings(left, right, pageCapacity, branchFactor);
  return replacePair(children, leftIndex, first, second);
}

function deleteNode<T>(
  node: TreeNode<T>,
  index: number,
  pageCapacity: number,
  branchFactor: number,
  rebalance: boolean,
): TreeNode<T> | null {
  if (node.kind === 'leaf') {
    return node.items.length === 1 ? null : leaf(removeValue(node.items, index));
  }

  const selected = childIndexForRead(node, index);
  const start = childStart(node, selected);
  const updatedChild = deleteNode(
    node.children[selected] as TreeNode<T>,
    index - start,
    pageCapacity,
    branchFactor,
    rebalance,
  );
  const children = new Array<TreeNode<T>>(node.children.length - (updatedChild ? 0 : 1));
  let target = 0;

  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    if (childIndex === selected) {
      if (updatedChild) {
        children[target] = updatedChild;
        target += 1;
      }

      continue;
    }

    children[target] = node.children[childIndex] as TreeNode<T>;
    target += 1;
  }

  if (children.length === 0) {
    return null;
  }

  const balanced = rebalance
    ? rebalanceChild(children, Math.min(selected, children.length - 1), pageCapacity, branchFactor)
    : children;

  return branch(balanced);
}

function forEachNode<T>(
  node: TreeNode<T>,
  callback: (value: T, index: number) => void,
  offset: number,
): void {
  if (node.kind === 'leaf') {
    const items = node.items;

    for (let index = 0; index < items.length; index += 1) {
      callback(items[index] as T, offset + index);
    }

    return;
  }

  let childOffset = offset;
  const children = node.children;

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as TreeNode<T>;
    forEachNode(child, callback, childOffset);
    childOffset += child.length;
  }
}

function iterateNode<T>(root: TreeNode<T>): IterableIterator<T> {
  const pending: TreeNode<T>[] = [root];
  let currentItems: readonly T[] | undefined;
  let currentIndex = 0;

  const iterator: IterableIterator<T> = {
    next(): IteratorResult<T> {
      while (true) {
        if (currentItems && currentIndex < currentItems.length) {
          const value = currentItems[currentIndex];
          currentIndex += 1;

          return { done: false, value: value as T };
        }

        currentItems = undefined;

        const node = pending.pop();

        if (!node) {
          return { done: true, value: undefined };
        }

        if (node.kind === 'leaf') {
          currentItems = node.items;
          currentIndex = 0;
          continue;
        }

        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          const child = node.children[index];

          if (child) {
            pending.push(child);
          }
        }
      }
    },
    [Symbol.iterator]() {
      return this;
    },
  };

  return iterator;
}

function deleteRangeNode<T>(
  node: TreeNode<T>,
  start: number,
  end: number,
  pageCapacity: number,
  branchFactor: number,
  rebalance: boolean,
): TreeNode<T> | null {
  if (start === 0 && end >= node.length) {
    return null;
  }

  if (node.kind === 'leaf') {
    const items = [...node.items.slice(0, start), ...node.items.slice(end)];

    return items.length === 0 ? null : leaf(items);
  }

  const children: TreeNode<T>[] = [];
  let offset = 0;

  for (const child of node.children) {
    const childEnd = offset + child.length;

    if (childEnd <= start || offset >= end) {
      children.push(child);
    } else if (start <= offset && end >= childEnd) {
      // The complete child is removed.
    } else {
      const localStart = Math.max(0, start - offset);
      const localEnd = Math.min(child.length, end - offset);
      const updated = deleteRangeNode(
        child,
        localStart,
        localEnd,
        pageCapacity,
        branchFactor,
        rebalance,
      );

      if (updated) {
        children.push(updated);
      }
    }

    offset = childEnd;
  }

  if (children.length === 0) {
    return null;
  }

  let balanced = children;

  if (rebalance) {
    let index = 0;

    while (index < balanced.length) {
      const previousLength = balanced.length;
      balanced = rebalanceChild(balanced, index, pageCapacity, branchFactor);

      if (balanced.length < previousLength) {
        index = Math.max(0, index - 1);
      } else {
        index += 1;
      }
    }
  }

  return branch(balanced);
}

function normalizeRoot<T>(node: TreeNode<T>): TreeNode<T> {
  let root = node;

  while (root.kind === 'branch' && root.children.length === 1) {
    root = root.children[0] as TreeNode<T>;
  }

  return root;
}

function assertBPlusNode<T>(
  node: TreeNode<T>,
  isRoot: boolean,
  pageCapacity: number,
  branchFactor: number,
): void {
  if (node.kind === 'leaf') {
    if (
      node.length !== node.items.length ||
      node.length > pageCapacity ||
      (!isRoot && node.length < Math.ceil(pageCapacity / 2))
    ) {
      throw new Error('B+ tree leaf occupancy invariant failed.');
    }

    return;
  }

  if (
    node.children.length > branchFactor ||
    node.children.length < (isRoot ? 2 : Math.ceil(branchFactor / 2))
  ) {
    throw new Error('B+ tree branch occupancy invariant failed.');
  }

  let total = 0;
  const expectedHeight = node.children[0]?.height;

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];

    if (!child || child.height !== expectedHeight) {
      throw new Error('B+ tree leaf-depth invariant failed.');
    }

    assertBPlusNode(child, false, pageCapacity, branchFactor);
    total += child.length;

    if (node.sizes[index] !== total) {
      throw new Error('B+ tree subtree-size metadata invariant failed.');
    }
  }

  if (node.length !== total || node.height !== (expectedHeight ?? -1) + 1) {
    throw new Error('B+ tree aggregate metadata invariant failed.');
  }
}

function validateCapacity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 4) {
    throw new RangeError(`${name} must be an integer greater than or equal to 4.`);
  }
}

export interface VectorDraft<T> {
  readonly length: number;
  get(index: number): T | undefined;
  set(index: number, value: T): this;
  insert(index: number, value: T): this;
  delete(index: number): this;
  deleteRange(start: number, end: number): this;
}

export interface PersistentTreeVector<T> extends Iterable<T> {
  [Symbol.iterator](): IterableIterator<T>;
  readonly length: number;
  readonly kind: TreeKind;
  readonly pageSize: number;
  get(index: number): T | undefined;
  set(index: number, value: T): PersistentTreeVector<T>;
  setMany(
    changes: readonly { readonly index: number; readonly value: T }[] | Map<number, T>,
  ): PersistentTreeVector<T>;
  insert(index: number, value: T): PersistentTreeVector<T>;
  delete(index: number): PersistentTreeVector<T>;
  deleteRange(start: number, end: number): PersistentTreeVector<T>;
  slice(start?: number, end?: number): PersistentTreeVector<T>;
  splice(start: number, deleteCount: number, ...items: T[]): PersistentTreeVector<T>;
  concat(other: Iterable<T>): PersistentTreeVector<T>;
  convertTo(tree: typeof TREE.B_PLUS, options?: TreeOptions): BPlusVector<T>;
  convertTo(tree: typeof TREE.RRB, options?: TreeOptions): RRBVector<T>;
  convertTo(tree: TreeKind, options?: TreeOptions): PersistentTreeVector<T>;
  toBPlus(options?: TreeOptions): BPlusVector<T>;
  toRRB(options?: TreeOptions): RRBVector<T>;
  withProfile(profile: PageProfile): PersistentTreeVector<T>;
  snapshot(): PersistentTreeVector<T>;
  toArray(): T[];
  forEach(callback: (value: T, index: number) => void): void;
  builder(): VectorBuilder<T>;
  transact(callback: (draft: VectorDraft<T>) => void): PersistentTreeVector<T>;
  assertValid(): void;
}

export class BPlusVectorImpl<T> implements PersistentTreeVector<T> {
  readonly #root: TreeNode<T>;
  readonly #pageCapacity: number;
  readonly #branchFactor: number;

  private constructor(root: TreeNode<T>, pageCapacity: number, branchFactor: number) {
    this.#root = root;
    this.#pageCapacity = pageCapacity;
    this.#branchFactor = branchFactor;
  }

  static from<T>(values: readonly T[], options: TreeOptions = {}): BPlusVectorImpl<T> {
    const pageCapacity = resolvePageCapacity(options, values.length);
    const branchFactor = options.branchFactor ?? DEFAULT_BRANCH_FACTOR;

    validateCapacity(pageCapacity, 'pageSize');
    validateCapacity(branchFactor, 'branchFactor');

    return new BPlusVectorImpl(
      buildTree(values, pageCapacity, branchFactor),
      pageCapacity,
      branchFactor,
    );
  }

  static fromIterable<T>(
    values: Iterable<T>,
    options: TreeOptions,
    length: number,
  ): BPlusVectorImpl<T> {
    const pageCapacity = resolvePageCapacity(options, length);
    const branchFactor = options.branchFactor ?? DEFAULT_BRANCH_FACTOR;

    validateCapacity(branchFactor, 'branchFactor');

    return new BPlusVectorImpl(
      buildTreeFromIterable(values, pageCapacity, branchFactor),
      pageCapacity,
      branchFactor,
    );
  }

  assertValid(): void {
    assertBPlusNode(this.#root, true, this.#pageCapacity, this.#branchFactor);
  }

  inspectStructure(): TreeStructureStats {
    return inspectTree(this.#root);
  }

  get length(): number {
    return this.#root.length;
  }

  get kind(): typeof TREE.B_PLUS {
    return TREE.B_PLUS;
  }

  get pageSize(): number {
    return this.#pageCapacity;
  }

  get(index: number): T | undefined {
    this.#assertIndex(index);

    return getNode(this.#root, index);
  }

  set(index: number, value: T): PersistentTreeVector<T> {
    this.#assertIndex(index);
    const root = setNode(this.#root, index, value);

    return root === this.#root
      ? this
      : new BPlusVectorImpl(root, this.#pageCapacity, this.#branchFactor);
  }

  setMany(
    changes: readonly { readonly index: number; readonly value: T }[] | Map<number, T>,
  ): PersistentTreeVector<T> {
    let pending: Map<number, T>;

    if (changes instanceof Map) {
      pending = changes;

      for (const index of pending.keys()) {
        this.#assertIndex(index);
      }
    } else {
      pending = new Map<number, T>();

      for (const change of changes) {
        this.#assertIndex(change.index);
        pending.set(change.index, change.value);
      }
    }

    const sorted = [...pending].sort(([left], [right]) => left - right);
    const root = setManyNode(this.#root, sorted, 0, sorted.length);

    return root === this.#root
      ? this
      : new BPlusVectorImpl(root, this.#pageCapacity, this.#branchFactor);
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
    this.#assertInsertIndex(index);

    const result = insertNode(this.#root, index, value, this.#pageCapacity, this.#branchFactor);
    const root = result.right ? branch([result.left, result.right]) : result.left;

    return new BPlusVectorImpl(root, this.#pageCapacity, this.#branchFactor);
  }

  delete(index: number): PersistentTreeVector<T> {
    this.#assertIndex(index);

    const root =
      deleteNode(this.#root, index, this.#pageCapacity, this.#branchFactor, true) ?? leaf([]);
    const normalized = normalizeRoot(root);

    return new BPlusVectorImpl(normalized, this.#pageCapacity, this.#branchFactor);
  }

  deleteRange(start: number, end: number): PersistentTreeVector<T> {
    this.#assertRange(start, end);

    if (start === end) {
      return this;
    }

    const root =
      deleteRangeNode(this.#root, start, end, this.#pageCapacity, this.#branchFactor, true) ??
      leaf([]);
    const normalized = normalizeRoot(root);

    return new BPlusVectorImpl(normalized, this.#pageCapacity, this.#branchFactor);
  }

  slice(start = 0, end = this.length): PersistentTreeVector<T> {
    const normalizedStart = normalizeSliceIndex(start, this.length);
    const normalizedEnd = Math.max(normalizedStart, normalizeSliceIndex(end, this.length));

    if (normalizedStart === 0 && normalizedEnd === this.length) {
      return this;
    }

    if (normalizedStart === normalizedEnd) {
      return new BPlusVectorImpl(leaf([]), this.#pageCapacity, this.#branchFactor);
    }

    return BPlusVectorImpl.fromIterable(
      sliceValues(this, normalizedStart, normalizedEnd),
      { pageSize: this.#pageCapacity, branchFactor: this.#branchFactor },
      normalizedEnd - normalizedStart,
    );
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

    return BPlusVectorImpl.fromIterable(
      spliceValues(this, normalizedStart, end, items),
      { pageSize: this.#pageCapacity, branchFactor: this.#branchFactor },
      this.length - normalizedDeleteCount + items.length,
    );
  }

  concat(other: Iterable<T>): PersistentTreeVector<T> {
    const candidateLength = (other as unknown as { length?: unknown }).length;
    const otherLength = typeof candidateLength === 'number' ? candidateLength : undefined;

    return BPlusVectorImpl.fromIterable(
      concatValues(this, other),
      { pageSize: this.#pageCapacity, branchFactor: this.#branchFactor },
      otherLength === undefined ? 0 : this.length + otherLength,
    );
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
    const targetCapacity =
      options.pageSize === undefined && options.profile === undefined
        ? this.#pageCapacity
        : resolvePageCapacity(options, this.length);
    const targetBranchFactor = options.branchFactor ?? this.#branchFactor;

    if (targetCapacity === this.#pageCapacity && targetBranchFactor === this.#branchFactor) {
      return this;
    }

    return BPlusVectorImpl.fromIterable(
      this,
      { ...options, pageSize: targetCapacity, branchFactor: targetBranchFactor },
      this.length,
    );
  }

  toRRB(options: TreeOptions = {}): RRBVector<T> {
    return createRrbFromIterable(
      this,
      {
        ...options,
        pageSize:
          options.pageSize ??
          (options.profile ? selectPageCapacity(this.length, options.profile) : this.#pageCapacity),
        branchFactor: options.branchFactor ?? this.#branchFactor,
      },
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
    return iterateNode(this.#root);
  }

  #assertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) {
      throw new RangeError(`Index ${index} is outside a collection of length ${this.length}.`);
    }
  }

  #assertInsertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.length) {
      throw new RangeError(
        `Insertion index ${index} is outside a collection of length ${this.length}.`,
      );
    }
  }

  #assertRange(start: number, end: number): void {
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

export function createBPlusFromIterable<T>(
  values: Iterable<T>,
  options: TreeOptions,
  length: number,
): BPlusVector<T> {
  return BPlusVectorImpl.fromIterable(values, options, length);
}

export class VectorBuilder<T> implements VectorDraft<T> {
  readonly #base: PersistentTreeVector<T>;
  #current: PersistentTreeVector<T>;
  #pending = new Map<number, T>();
  #state: 'open' | 'committed' | 'rolled-back' = 'open';

  constructor(base: PersistentTreeVector<T>) {
    this.#base = base;
    this.#current = base;
  }

  get length(): number {
    this.#assertOpen();
    return this.#current.length;
  }

  get(index: number): T | undefined {
    this.#assertOpen();
    this.#assertIndex(index);
    return this.#pending.has(index) ? this.#pending.get(index) : this.#current.get(index);
  }

  set(index: number, value: T): this {
    this.#assertOpen();
    this.#assertIndex(index);
    this.#pending.set(index, value);
    return this;
  }

  insert(index: number, value: T): this {
    this.#assertOpen();
    this.#flush();
    this.#current = this.#current.insert(index, value);
    return this;
  }

  delete(index: number): this {
    this.#assertOpen();
    this.#flush();
    this.#current = this.#current.delete(index);
    return this;
  }

  deleteRange(start: number, end: number): this {
    this.#assertOpen();
    this.#flush();
    this.#current = this.#current.deleteRange(start, end);
    return this;
  }

  commit(): PersistentTreeVector<T> {
    this.#assertOpen();
    this.#flush();
    this.#state = 'committed';
    return this.#current;
  }

  rollback(): void {
    this.#assertOpen();
    this.#pending.clear();
    this.#current = this.#base;
    this.#state = 'rolled-back';
  }

  #flush(): void {
    if (this.#pending.size === 0) {
      return;
    }

    this.#current = this.#current.setMany(this.#pending);
    this.#pending.clear();
  }

  #assertIndex(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.#current.length) {
      throw new RangeError(
        `Index ${index} is outside a collection of length ${this.#current.length}.`,
      );
    }
  }

  #assertOpen(): void {
    if (this.#state !== 'open') {
      throw new Error(`Transaction builder is ${this.#state}.`);
    }
  }
}

export type BPlusVector<T> = PersistentTreeVector<T> & { readonly kind: typeof TREE.B_PLUS };

export const BPlusVector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): BPlusVector<T> {
    return BPlusVectorImpl.from(values, options);
  },
};

export type RrbVector<T> = RRBVector<T>;
export type RRBVector<T> = PersistentTreeVector<T> & { readonly kind: typeof TREE.RRB };

export { RrbVector };
export const RRBVector = RrbVector;

export type Vector<T> = PersistentTreeVector<T>;

function automaticTree(profile: PageProfile): TreeKind {
  return profile === PROFILE.MUTATION_HEAVY ? TREE.B_PLUS : TREE.RRB;
}

export const Vector = {
  from<T>(values: readonly T[], options: VectorOptions = {}): Vector<T> {
    assertValidProfile(options.profile);

    if (
      options.tree !== undefined &&
      options.tree !== TREE.AUTO &&
      options.tree !== TREE.B_PLUS &&
      options.tree !== TREE.RRB
    ) {
      throw new TypeError(`Unknown tree selection: ${String(options.tree)}.`);
    }

    const profile = options.profile ?? PROFILE.BALANCED;
    const tree =
      options.tree === undefined || options.tree === TREE.AUTO
        ? automaticTree(profile)
        : options.tree;

    if (tree === TREE.B_PLUS) {
      return BPlusVector.from(values, { ...options, profile });
    }

    return RrbVector.from(values, { ...options, profile });
  },
};
