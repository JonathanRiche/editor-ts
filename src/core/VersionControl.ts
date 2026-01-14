import type { PageData } from '../types';

export type VersionNodeMeta = {
  source?: 'user' | 'ai' | 'system';
  message?: string;
};

export type VersionNode = {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  createdAt: number;
  snapshot: PageData;
  meta?: VersionNodeMeta;
};

export type VersionControlState = {
  rootId: string;
  currentId: string;
  nodes: Record<string, VersionNode>;
};

export type VersionControlOptions = {
  maxSnapshots?: number;
};

const createId = (): string => {
  return `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export class VersionControl {
  private maxSnapshots: number;
  private state: VersionControlState;

  constructor(options?: VersionControlOptions) {
    this.maxSnapshots = options?.maxSnapshots ?? 200;

    const rootId = createId();
    // Temporary placeholder; caller must init() to set snapshot.
    this.state = {
      rootId,
      currentId: rootId,
      nodes: {
        [rootId]: {
          id: rootId,
          parentId: null,
          childrenIds: [],
          createdAt: Date.now(),
          snapshot: { title: '', item_id: 0, body: {} },
        },
      },
    };
  }

  private cloneSnapshot(snapshot: PageData): PageData {
    return JSON.parse(JSON.stringify(snapshot)) as PageData;
  }

  init(snapshot: PageData, meta?: VersionNodeMeta): void {
    const root = this.state.nodes[this.state.rootId];
    if (!root) return;

    root.snapshot = this.cloneSnapshot(snapshot);
    root.meta = meta;
    root.createdAt = Date.now();
    this.state.currentId = root.id;
  }

  static fromState(state: VersionControlState, options?: VersionControlOptions): VersionControl {
    const vc = new VersionControl(options);
    vc.state = state;
    return vc;
  }

  getState(): VersionControlState {
    return this.state;
  }

  getCurrentId(): string {
    return this.state.currentId;
  }

  getCurrentSnapshot(): PageData {
    const current = this.state.nodes[this.state.currentId];
    const snapshot = current ? current.snapshot : this.state.nodes[this.state.rootId]!.snapshot;
    return this.cloneSnapshot(snapshot);
  }

  getRedoOptions(): string[] {
    const current = this.state.nodes[this.state.currentId];
    return current ? current.childrenIds.slice() : [];
  }

  canUndo(): boolean {
    const current = this.state.nodes[this.state.currentId];
    return !!current && current.parentId !== null;
  }

  canRedo(): boolean {
    const current = this.state.nodes[this.state.currentId];
    return !!current && current.childrenIds.length > 0;
  }

  commit(snapshot: PageData, meta?: VersionNodeMeta): string {
    const parentId = this.state.currentId;
    const parent = this.state.nodes[parentId];
    if (!parent) {
      throw new Error('VersionControl: missing parent node');
    }

    const id = createId();

    const node: VersionNode = {
      id,
      parentId,
      childrenIds: [],
      createdAt: Date.now(),
      snapshot: this.cloneSnapshot(snapshot),
      meta,
    };

    this.state.nodes[id] = node;
    parent.childrenIds.push(id);
    this.state.currentId = id;

    this.prune();

    return id;
  }

  undo(): PageData | null {
    const current = this.state.nodes[this.state.currentId];
    if (!current || !current.parentId) return null;

    const parent = this.state.nodes[current.parentId];
    if (!parent) return null;

    this.state.currentId = parent.id;
    return this.cloneSnapshot(parent.snapshot);
  }

  redo(childId?: string): PageData | null {
    const current = this.state.nodes[this.state.currentId];
    if (!current || current.childrenIds.length === 0) return null;

    const nextId = childId ?? current.childrenIds[current.childrenIds.length - 1]!;
    const next = this.state.nodes[nextId];
    if (!next) return null;

    this.state.currentId = next.id;
    return this.cloneSnapshot(next.snapshot);
  }

  checkout(id: string): PageData | null {
    if (!this.state.nodes[id]) return null;
    this.state.currentId = id;
    return this.cloneSnapshot(this.state.nodes[id].snapshot);
  }

  private prune(): void {
    const nodeIds = Object.keys(this.state.nodes);
    if (nodeIds.length <= this.maxSnapshots) return;

    const protectedIds = new Set<string>([this.state.rootId, this.state.currentId]);

    const leaves = nodeIds
      .map((id) => this.state.nodes[id])
      .filter((n): n is VersionNode => !!n && !protectedIds.has(n.id) && n.childrenIds.length === 0);

    leaves.sort((a, b) => a.createdAt - b.createdAt);

    while (Object.keys(this.state.nodes).length > this.maxSnapshots && leaves.length > 0) {
      const leaf = leaves.shift();
      if (!leaf) break;

      const parentId = leaf.parentId;
      delete this.state.nodes[leaf.id];

      if (parentId && this.state.nodes[parentId]) {
        const parent = this.state.nodes[parentId];
        parent.childrenIds = parent.childrenIds.filter((cid) => cid !== leaf.id);
        if (parent.childrenIds.length === 0 && !protectedIds.has(parent.id)) {
          leaves.push(parent);
          leaves.sort((a, b) => a.createdAt - b.createdAt);
        }
      }
    }
  }
}
