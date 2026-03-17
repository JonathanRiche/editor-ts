import { describe, expect, it } from 'bun:test';
import { VersionControl } from '../src/core/VersionControl';
import type { PageData } from '../src/types';

describe('VersionControl', () => {
  const snapshot = (title: string): PageData => ({
    title,
    item_id: 1,
    body: { components: [], assets: [], styles: [] },
  });

  it('initializes root snapshot and current id', () => {
    const vc = new VersionControl();
    vc.init(snapshot('root'), { source: 'system' });

    const state = vc.getState();

    expect(state.rootId).toBe(state.currentId);
    expect(state.nodes[state.rootId]?.snapshot.title).toBe('root');
  });

  it('commits snapshots and supports undo/redo', () => {
    const vc = new VersionControl();
    vc.init(snapshot('root'));

    vc.commit(snapshot('v1'));
    vc.commit(snapshot('v2'));

    expect(vc.getCurrentSnapshot().title).toBe('v2');

    const undo = vc.undo();
    expect(undo?.title).toBe('v1');
    expect(vc.getCurrentSnapshot().title).toBe('v1');

    const redo = vc.redo();
    expect(redo?.title).toBe('v2');
  });

  it('supports checkout by node id', () => {
    const vc = new VersionControl();
    vc.init(snapshot('root'));

    const v1 = vc.commit(snapshot('v1'));
    const v2 = vc.commit(snapshot('v2'));

    const checked = vc.checkout(v1);
    expect(checked?.title).toBe('v1');
    expect(vc.getCurrentId()).toBe(v1);

    const checkedAgain = vc.checkout(v2);
    expect(checkedAgain?.title).toBe('v2');
  });

  it('prunes oldest leaves when maxSnapshots exceeded', () => {
    const vc = new VersionControl({ maxSnapshots: 3 });
    vc.init(snapshot('root'));

    vc.commit(snapshot('v1'));
    const v2 = vc.commit(snapshot('v2'));
    vc.undo();
    const v1b = vc.commit(snapshot('v1b'));

    const state = vc.getState();

    expect(Object.keys(state.nodes).length).toBeLessThanOrEqual(3);
    expect(state.nodes[state.rootId]).toBeDefined();
    expect(state.nodes[v2]).toBeUndefined();
    expect(state.nodes[v1b]).toBeDefined();
  });
});
