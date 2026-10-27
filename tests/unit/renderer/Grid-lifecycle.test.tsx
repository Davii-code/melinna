import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../../../src/renderer/components/Grid/Grid';
import { createLayoutStore } from '../../../src/renderer/store/layout-store';
import { fakeApi, okR } from '../../support/fake-api';

const observe = () => () => undefined;
describe('workspace presentation continuity', () => {
  it('does not remount panes when moving between visible and hidden collections', () => {
    const mounts = vi.fn();
    const unmounts = vi.fn();
    function Pane({ id }: { id: string }) {
      useEffect(() => {
        mounts(id);
        return () => unmounts(id);
      }, [id]);
      return <span data-testid={id}>{id}</span>;
    }
    const props = {
      ids: ['t1', 't2', 'e1'],
      editorIds: ['e1'],
      renderPanel: (id: string) => <Pane id={id} />,
      observeResize: observe,
    };
    const { rerender } = render(<Grid {...props} mode="development" />);
    const original = screen.getByTestId('t1');
    rerender(<Grid {...props} mode="development" editorFocus />);
    expect(screen.getByTestId('cell-t1').getAttribute('aria-hidden')).toBe('true');
    rerender(<Grid {...props} mode="terminals" />);
    rerender(<Grid {...props} mode="custom" hidden />);
    rerender(<Grid {...props} mode="development" />);
    expect(screen.getByTestId('t1')).toBe(original);
    expect(mounts).toHaveBeenCalledTimes(3);
    expect(unmounts).not.toHaveBeenCalled();
  });
  it('opens development automatically but protects a custom layout and restores saved modes', async () => {
    const api = fakeApi();
    const store = createLayoutStore(api);
    store.open('t1');
    store.open('t2');
    store.openDoc('/w/a.ts');
    expect(store.get().mode).toBe('development');
    store.setMode('custom');
    const custom = store.get().custom;
    store.openDoc('/w/b.ts');
    expect(store.get().mode).toBe('custom');
    expect(store.get().custom).toBe(custom);
    await store.flush();
    api.layout.get.mockImplementation(() => okR(store.get()));
    const restored = createLayoutStore(api);
    await restored.load();
    expect(restored.get().mode).toBe('custom');
  });
  it('unchanged workspace updates neither restart the save debounce nor create a persistence loop', async () => {
    const api = fakeApi();
    const schedule = vi.fn(() => () => undefined);
    const store = createLayoutStore(api, schedule);
    store.open('t1');
    const snapshot = store.get();
    schedule.mockClear();
    store.prune(new Set(['t1']));
    expect(store.get()).toBe(snapshot);
    expect(schedule).not.toHaveBeenCalled();
    await store.flush();
    expect(api.layout.set).toHaveBeenCalledTimes(1);
  });
});
