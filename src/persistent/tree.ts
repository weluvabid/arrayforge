export type TreeKind = 'bplus' | 'rrb';

export type PageProfile = 'balanced' | 'mutation-heavy' | 'read-heavy';

export interface TreeOptions {
  readonly pageCapacity?: number | 'adaptive';
  readonly profile?: PageProfile;
  readonly branchFactor?: number;
}

export function selectPageCapacity(length: number, profile: PageProfile = 'balanced'): number {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError('Collection length must be a non-negative safe integer.');
  }

  if (profile === 'mutation-heavy') {
    return 256;
  }

  if (profile === 'read-heavy') {
    return length >= 1_000_000 ? 1024 : 512;
  }

  return length <= 100_000 ? 256 : 512;
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
  readonly length: number;
  readonly height: number;
}

type TreeNode<T> = LeafNode<T> | BranchNode<T>;

interface InsertResult<T> {
  readonly left: TreeNode<T>;
  readonly right?: TreeNode<T>;
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
  let length = 0;

  for (let index = 0; index < children.length; index += 1) {
    length += children[index]?.length ?? 0;
    sizes[index] = length;
  }

  return {
    kind: 'branch',
    children,
    sizes,
    length,
    height: (children[0]?.height ?? -1) + 1,
  };
}

function childIndexForRead<T>(node: BranchNode<T>, index: number): number {
  let low = 0;
  let high = node.sizes.length - 1;

  while (low < high) {
    const middle = (low + high) >>> 1;

    if ((node.sizes[middle] ?? 0) > index) {
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
  return childIndex === 0 ? 0 : (node.sizes[childIndex - 1] ?? 0);
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

function insertNode<T>(
  node: TreeNode<T>,
  index: number,
  value: T,
  pageCapacity: number,
  branchFactor: number,
): InsertResult<T> {
  if (node.kind === 'leaf') {
    const items = node.items.slice() as T[];
    items.splice(index, 0, value);

    if (items.length <= pageCapacity) {
      return { left: leaf(items) };
    }

    const midpoint = Math.ceil(items.length / 2);

    return {
      left: leaf(items.slice(0, midpoint)),
      right: leaf(items.slice(midpoint)),
    };
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
  const children = node.children.slice() as TreeNode<T>[];
  children.splice(selected, 1, childResult.left);

  if (childResult.right) {
    children.splice(selected + 1, 0, childResult.right);
  }

  if (children.length <= branchFactor) {
    return { left: branch(children) };
  }

  const midpoint = Math.ceil(children.length / 2);

  return {
    left: branch(children.slice(0, midpoint)),
    right: branch(children.slice(midpoint)),
  };
}

function combineSiblings<T>(
  left: TreeNode<T>,
  right: TreeNode<T>,
  pageCapacity: number,
  branchFactor: number,
): readonly [TreeNode<T>, TreeNode<T>?] {
  if (left.kind === 'leaf' && right.kind === 'leaf') {
    const combined = [...left.items, ...right.items];

    if (combined.length <= pageCapacity) {
      return [leaf(combined)];
    }

    const midpoint = Math.ceil(combined.length / 2);

    return [leaf(combined.slice(0, midpoint)), leaf(combined.slice(midpoint))];
  }

  if (left.kind === 'branch' && right.kind === 'branch') {
    const combined = [...left.children, ...right.children];

    if (combined.length <= branchFactor) {
      return [branch(combined)];
    }

    const midpoint = Math.ceil(combined.length / 2);

    return [branch(combined.slice(0, midpoint)), branch(combined.slice(midpoint))];
  }

  return [left, right];
}

function rebalanceChild<T>(
  children: TreeNode<T>[],
  index: number,
  pageCapacity: number,
  branchFactor: number,
): void {
  const current = children[index];

  if (!current || children.length < 2) {
    return;
  }

  const minimum =
    current.kind === 'leaf' ? Math.ceil(pageCapacity / 2) : Math.ceil(branchFactor / 2);
  const occupancy = current.kind === 'leaf' ? current.items.length : current.children.length;

  if (occupancy >= minimum) {
    return;
  }

  const leftIndex = index > 0 ? index - 1 : index;
  const rightIndex = leftIndex + 1;
  const left = children[leftIndex];
  const right = children[rightIndex];

  if (!left || !right) {
    return;
  }

  const [first, second] = combineSiblings(left, right, pageCapacity, branchFactor);
  children.splice(leftIndex, 2, first);

  if (second) {
    children.splice(leftIndex + 1, 0, second);
  }
}

function deleteNode<T>(
  node: TreeNode<T>,
  index: number,
  pageCapacity: number,
  branchFactor: number,
  rebalance: boolean,
): TreeNode<T> | null {
  if (node.kind === 'leaf') {
    const items = node.items.slice() as T[];
    items.splice(index, 1);

    return items.length === 0 ? null : leaf(items);
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
  const children = node.children.slice() as TreeNode<T>[];

  if (updatedChild) {
    children[selected] = updatedChild;

    if (rebalance) {
      rebalanceChild(children, selected, pageCapacity, branchFactor);
    }
  } else {
    children.splice(selected, 1);
  }

  if (children.length === 0) {
    return null;
  }

  return branch(children);
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

  if (rebalance) {
    let index = 0;

    while (index < children.length) {
      const previousLength = children.length;
      rebalanceChild(children, index, pageCapacity, branchFactor);

      if (children.length < previousLength) {
        index = Math.max(0, index - 1);
      } else {
        index += 1;
      }
    }
  }

  return branch(children);
}

function normalizeRoot<T>(node: TreeNode<T>): TreeNode<T> {
  let root = node;

  while (root.kind === 'branch' && root.children.length === 1) {
    root = root.children[0] as TreeNode<T>;
  }

  return root;
}

function validateCapacity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 4) {
    throw new RangeError(`${name} must be an integer greater than or equal to 4.`);
  }
}

export class PersistentTreeVector<T> implements Iterable<T> {
  readonly #root: TreeNode<T>;
  readonly #pageCapacity: number;
  readonly #branchFactor: number;
  readonly #kind: TreeKind;

  private constructor(
    root: TreeNode<T>,
    kind: TreeKind,
    pageCapacity: number,
    branchFactor: number,
  ) {
    this.#root = root;
    this.#kind = kind;
    this.#pageCapacity = pageCapacity;
    this.#branchFactor = branchFactor;
  }

  static from<T>(
    values: readonly T[],
    kind: TreeKind,
    options: TreeOptions = {},
  ): PersistentTreeVector<T> {
    const pageCapacity =
      options.pageCapacity === undefined || options.pageCapacity === 'adaptive'
        ? selectPageCapacity(values.length, options.profile)
        : options.pageCapacity;
    const branchFactor = options.branchFactor ?? DEFAULT_BRANCH_FACTOR;

    validateCapacity(pageCapacity, 'pageCapacity');
    validateCapacity(branchFactor, 'branchFactor');

    return new PersistentTreeVector(
      buildTree(values, pageCapacity, branchFactor),
      kind,
      pageCapacity,
      branchFactor,
    );
  }

  get length(): number {
    return this.#root.length;
  }

  get kind(): TreeKind {
    return this.#kind;
  }

  get pageCapacity(): number {
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
      : new PersistentTreeVector(root, this.#kind, this.#pageCapacity, this.#branchFactor);
  }

  insert(index: number, value: T): PersistentTreeVector<T> {
    this.#assertInsertIndex(index);

    const result = insertNode(this.#root, index, value, this.#pageCapacity, this.#branchFactor);
    const root = result.right ? branch([result.left, result.right]) : result.left;

    return new PersistentTreeVector(root, this.#kind, this.#pageCapacity, this.#branchFactor);
  }

  delete(index: number): PersistentTreeVector<T> {
    this.#assertIndex(index);

    const root =
      deleteNode(
        this.#root,
        index,
        this.#pageCapacity,
        this.#branchFactor,
        this.#kind === 'bplus',
      ) ?? leaf([]);
    const normalized = normalizeRoot(root);

    return new PersistentTreeVector(normalized, this.#kind, this.#pageCapacity, this.#branchFactor);
  }

  deleteRange(start: number, end: number): PersistentTreeVector<T> {
    this.#assertRange(start, end);

    if (start === end) {
      return this;
    }

    const root =
      deleteRangeNode(
        this.#root,
        start,
        end,
        this.#pageCapacity,
        this.#branchFactor,
        this.#kind === 'bplus',
      ) ?? leaf([]);
    const normalized = normalizeRoot(root);

    return new PersistentTreeVector(normalized, this.#kind, this.#pageCapacity, this.#branchFactor);
  }

  snapshot(): PersistentTreeVector<T> {
    return this;
  }

  toArray(): T[] {
    return [...this];
  }

  *[Symbol.iterator](): IterableIterator<T> {
    yield* iterateNode(this.#root);
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

export type BPlusVector<T> = PersistentTreeVector<T>;
export type RrbVector<T> = PersistentTreeVector<T>;

export const BPlusVector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): BPlusVector<T> {
    return PersistentTreeVector.from(values, 'bplus', options);
  },
};

export const RrbVector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): RrbVector<T> {
    return PersistentTreeVector.from(values, 'rrb', options);
  },
};

export type Vector<T> = PersistentTreeVector<T>;

export const Vector = {
  from<T>(values: readonly T[], options: TreeOptions = {}): Vector<T> {
    return PersistentTreeVector.from(values, 'rrb', options);
  },
};
