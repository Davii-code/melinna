import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePromptQueues } from '../../../src/renderer/prompts/use-queues';
import type { MelinnaApi, QueueItem } from '../../../src/shared/ipc-contract';
import { fakeApi, okR } from '../../support/fake-api';

const item = (id: string, text = id): QueueItem => ({ id, text, enqueuedAt: '2026-10-22T10:00:00.000Z' });

type Handle = ReturnType<typeof usePromptQueues>;

function setup(ids: string[], onError: (m: string) => void = () => undefined) {
  const api = fakeApi();
  const queues: Record<string, QueueItem[]> = { e1: [item('a'), item('b')], e2: [] };
  api.prompts.queue.get.mockImplementation((id: string) => okR(queues[id] ?? []));
  const seen: { current: Handle | null } = { current: null };
  function Probe({ ids: current }: { ids: string[] }) {
    seen.current = usePromptQueues(api as unknown as MelinnaApi, current, onError);
    return <div data-testid="probe" />;
  }
  const view = render(<Probe ids={ids} />);
  return {
    api,
    queues,
    handle: () => seen.current as Handle,
    rerender: (next: string[]) => view.rerender(<Probe ids={next} />),
    unmount: view.unmount,
  };
}

describe('usePromptQueues', () => {
  it('loads the queue of each execution and leaves out the empty ones', async () => {
    const { handle } = setup(['e1', 'e2']);
    await waitFor(() => expect(handle().queues.get('e1')?.map((i) => i.id)).toEqual(['a', 'b']));
    expect(handle().queues.has('e2')).toBe(false);
  });

  it('reloads when the library or the queues change', async () => {
    const { api, queues, handle } = setup(['e1']);
    await waitFor(() => expect(handle().queues.get('e1')).toHaveLength(2));
    queues.e1 = [item('a')];
    act(() => api.emitPromptsChange());
    await waitFor(() => expect(handle().queues.get('e1')).toHaveLength(1));
    queues.e1 = [];
    act(() => api.emitPromptsChange());
    await waitFor(() => expect(handle().queues.has('e1')).toBe(false));
  });

  it('follows the list of executions it is given', async () => {
    const { rerender, queues, handle } = setup(['e2']);
    await waitFor(() => expect(handle().queues.size).toBe(0));
    queues.e2 = [item('z')];
    rerender(['e1', 'e2']);
    await waitFor(() => expect(handle().queues.get('e2')).toHaveLength(1));
    expect(handle().queues.get('e1')).toHaveLength(2);
    rerender(['e2']);
    await waitFor(() => expect(handle().queues.has('e1')).toBe(false));
  });

  it('counts the discarded items per execution and lets the notice be dismissed', async () => {
    const { api, handle } = setup(['e1']);
    await waitFor(() => expect(handle().queues.size).toBe(1));
    act(() => api.emitQueueDiscarded({ execId: 'e1', items: 2, reason: 'ended' }));
    expect(handle().discarded.get('e1')).toBe(2);
    act(() => api.emitQueueDiscarded({ execId: 'e1', items: 1, reason: 'write-failed' }));
    expect(handle().discarded.get('e1')).toBe(3);
    act(() => handle().dismissDiscarded('e1'));
    expect(handle().discarded.has('e1')).toBe(false);
  });

  it('removes one item and clears a queue through the API, then reloads', async () => {
    const { api, queues, handle } = setup(['e1']);
    await waitFor(() => expect(handle().queues.get('e1')).toHaveLength(2));
    api.prompts.queue.remove.mockImplementation(() => {
      queues.e1 = [item('b')];
      return okR(queues.e1);
    });
    await act(async () => handle().removeItem('e1', 'a'));
    expect(api.prompts.queue.remove).toHaveBeenCalledWith('e1', 'a');
    await waitFor(() => expect(handle().queues.get('e1')?.map((i) => i.id)).toEqual(['b']));
    api.prompts.queue.clear.mockImplementation(() => {
      queues.e1 = [];
      return okR(undefined);
    });
    await act(async () => handle().clear('e1'));
    expect(api.prompts.queue.clear).toHaveBeenCalledWith('e1');
    await waitFor(() => expect(handle().queues.has('e1')).toBe(false));
  });

  it('reports the error when removing fails', async () => {
    const onError = vi.fn();
    const { api, handle } = setup(['e1'], onError);
    await waitFor(() => expect(handle().queues.get('e1')).toHaveLength(2));
    api.prompts.queue.clear.mockImplementation(() =>
      Promise.resolve({ ok: false as const, error: { code: 'IO_ERROR' as const, message: 'Falha ao gravar no disco.' } }),
    );
    await act(async () => handle().clear('e1'));
    expect(onError).toHaveBeenCalledWith('Falha ao gravar no disco.');
  });

  it('stops listening when it unmounts', async () => {
    const { api, handle, unmount } = setup(['e1']);
    await waitFor(() => expect(handle().queues.size).toBe(1));
    const before = api.prompts.queue.get.mock.calls.length;
    unmount();
    api.emitPromptsChange();
    api.emitQueueDiscarded({ execId: 'e1', items: 1, reason: 'ended' });
    expect(api.prompts.queue.get.mock.calls.length).toBe(before);
    expect(screen.queryByTestId('probe')).toBeNull();
  });
});
