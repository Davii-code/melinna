import { describe, expect, it } from 'vitest';
import { createWorkspaceStore } from '../../../src/renderer/store/workspace-store';
import { fakeApi, okR, snapshot } from '../../support/fake-api';

describe('workspace store', () => {
  it('loads the initial snapshot and follows workspace.onChange', async () => {
    const api = fakeApi();
    api.workspace.snapshot.mockImplementation(() => okR(snapshot({ version: 3 })));
    const store = createWorkspaceStore(api);
    let notified = 0;
    store.subscribe(() => notified++);
    await store.start();
    expect(store.get()?.version).toBe(3);
    api.emitChange(snapshot({ version: 4, liveCount: 2 }));
    expect(store.get()?.liveCount).toBe(2);
    api.emitChange(snapshot({ version: 2 }));
    expect(store.get()?.version).toBe(4);
    expect(notified).toBe(2);
    store.stop();
    api.emitChange(snapshot({ version: 9 }));
    expect(store.get()?.version).toBe(4);
  });
});
