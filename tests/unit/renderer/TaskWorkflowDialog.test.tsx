import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskWorkflowDialog } from '../../../src/renderer/components/Workflow/TaskWorkflowDialog';
import { emptyWorkflow, type TaskReview, type WorkflowApi } from '../../../src/shared/workflow-api';
import { fakeApi, okR, snapshot } from '../../support/fake-api';
import { agentDef, execution } from '../../support/renderer-fixtures';
function setup() {
  const base = fakeApi(),
    state = emptyWorkflow();
  const exec = execution('e1', { status: 'exited', worktreePath: '/repo' });
  const task = {
    id: 't1',
    groupId: 'g1',
    title: 'Fixture',
    prompt: 'Original goal',
    repoPath: '/repo',
    repoId: 'repo',
    baseRef: 'HEAD',
    baseCommit: '',
    slug: 'task',
    createdAt: new Date().toISOString(),
    isolation: 'direct' as const,
  };
  const checkpoint = {
    id: 'cp',
    taskId: 't1',
    executionId: 'e1',
    name: 'Before',
    reason: 'before-launch' as const,
    createdAt: new Date().toISOString(),
    manifest: { folders: [{ root: '/repo', files: [] }], fingerprint: 'before', scope: 'fixture' },
  };
  const review: TaskReview = {
    task,
    execution: exec,
    notes: { objective: 'Goal', decisions: '', pending: '', constraints: '' },
    checkpoint,
    checkpoints: [checkpoint],
    changes: [],
    fingerprint: 'current',
    verifications: [],
    handoffs: [],
    scope: 'fixture',
    otherLiveExecutions: [],
  };
  const api = {
    snapshot: vi.fn(() => okR(structuredClone(state))),
    review: vi.fn(() => okR(structuredClone(review))),
    saveProfile: vi.fn(async (profile) => {
      const saved = { ...profile, id: profile.id || 'profile' };
      state.profiles = [saved];
      return { ok: true as const, value: saved };
    }),
    removeProfile: vi.fn(() => okR(undefined)),
    preferences: vi.fn(async (prefs) => {
      state.preferences = prefs;
      return { ok: true as const, value: undefined };
    }),
    saveNotes: vi.fn(async (_id, notes) => {
      review.notes = notes;
      return { ok: true as const, value: undefined };
    }),
    checkpoint: vi.fn(() => okR(checkpoint)),
    diff: vi.fn(() => okR({ path: 'a.txt', change: 'modified' as const, hunks: [], lineCount: 0 })),
    previewRestore: vi.fn(() =>
      okR({
        id: 'preview',
        checkpointId: 'cp',
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        changes: [
          {
            root: '/repo',
            path: 'a.txt',
            change: 'modified' as const,
            beforeHash: 'before',
            afterHash: 'after',
            beforeBytes: 1,
            afterBytes: 1,
          },
        ],
      }),
    ),
    restore: vi.fn(() => okR(checkpoint)),
    draftHandoff: vi.fn(() => okR('Editable briefing')),
    handoff: vi.fn(() => okR([{ ok: true as const, agentId: 'claude', execId: 'e2' }])),
    verify: vi.fn(),
    cancelVerification: vi.fn(() => okR(undefined)),
    markRead: vi.fn(() => okR(undefined)),
    onChange: vi.fn(() => () => undefined),
  } satisfies WorkflowApi;
  const onClose = vi.fn(),
    onOpenExecution = vi.fn();
  render(
    <TaskWorkflowDialog
      api={{ ...base, workflow: api }}
      workflow={api}
      workspace={snapshot({
        groups: [{ id: 'g1', name: 'Workspace', order: 0 }],
        tasks: [task],
        executions: [exec],
      })}
      agents={[agentDef('claude')]}
      executionId="e1"
      initialTab="review"
      onClose={onClose}
      onOpenExecution={onOpenExecution}
    />,
  );
  return { api, review, onClose, onOpenExecution };
}
describe('task review, profiles and manual continuation UI', () => {
  it('edits task notes without automatically launching or sending them to an agent', async () => {
    const { api } = setup();
    const decisions = await screen.findByLabelText('Notas: Decisões');
    fireEvent.change(decisions, { target: { value: 'Keep component' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar notas' }));
    await waitFor(() =>
      expect(api.saveNotes).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ decisions: 'Keep component' }),
      ),
    );
    expect(api.handoff).not.toHaveBeenCalled();
  });
  it('offers an editable handoff and requires explicit confirmation before starting the destination', async () => {
    const { api, onOpenExecution } = setup();
    await screen.findByLabelText('Notas: Objetivo');
    fireEvent.click(screen.getByRole('button', { name: 'Passar para outro agente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preparar resumo com as notas' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Resumo para o próximo agente')).toHaveProperty(
        'value',
        'Editable briefing',
      ),
    );
    fireEvent.change(screen.getByLabelText('Resumo para o próximo agente'), {
      target: { value: 'My reviewed briefing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar continuação' }));
    expect(api.handoff).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Enviar continuação' }),
    );
    await waitFor(() =>
      expect(api.handoff).toHaveBeenCalledWith(
        expect.objectContaining({ executionId: 'e1', briefing: 'My reviewed briefing' }),
      ),
    );
    expect(onOpenExecution).toHaveBeenCalledWith('e2');
  });
  it('never restores files merely by opening the preview', async () => {
    const { api } = setup();
    await screen.findByLabelText('Notas: Objetivo');
    fireEvent.click(screen.getByRole('button', { name: 'Prévia da restauração' }));
    await screen.findByRole('alertdialog', { name: 'Confirmar restauração de arquivos' });
    expect(api.restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar arquivos' }));
    await waitFor(() => expect(api.restore).toHaveBeenCalledWith('preview'));
  });
  it('saves a reusable profile and keeps its instructions out of existing task notes', async () => {
    const { api } = setup();
    await screen.findByLabelText('Notas: Objetivo');
    fireEvent.click(screen.getByRole('button', { name: 'Perfis de uso' }));
    fireEvent.change(screen.getByLabelText('Nome do perfil'), { target: { value: 'My profile' } });
    fireEvent.change(screen.getByLabelText('Instruções do perfil'), { target: { value: 'Read only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() =>
      expect(api.saveProfile).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My profile', instructions: 'Read only' }),
      ),
    );
    expect(api.saveNotes).not.toHaveBeenCalled();
  });
  it('keeps quiet notifications disabled until explicitly enabled and labels them as an estimate', async () => {
    const { api } = setup();
    await screen.findByLabelText('Notas: Objetivo');
    fireEvent.click(screen.getByRole('button', { name: 'Avisos' }));
    const check = screen.getByLabelText('Avisar quando um agente ficar sem saída recente (estimativa)');
    expect(check).toHaveProperty('checked', false);
    fireEvent.click(check);
    await waitFor(() =>
      expect(api.preferences).toHaveBeenCalledWith(expect.objectContaining({ quietNotifications: true })),
    );
  });
});
