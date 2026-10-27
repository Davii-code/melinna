import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { MelinnaApi } from '../../src/shared/ipc-contract';
import { createTempRepo } from '../support/git-fixture';
import { systemNode } from '../support/fake-catalog';
import { cleanup, launchApp, makeUserData } from './harness';

test('review workflow: profiles, pre-existing edits, verification, handoff, guarded restore and persistence', async () => {
  test.setTimeout(150000);
  const repo = createTempRepo({ files: { 'main.ts': 'export const value = "committed";\n' } });
  writeFileSync(join(repo.root, 'main.ts'), 'export const value = "user edit";\n');
  const userData = makeUserData();
  let app = await launchApp(userData);
  try {
    const { page } = app;
    const group = await page.evaluate(async (root) => {
      const api = (window as unknown as { melinna: MelinnaApi }).melinna;
      const r = await api.workspace.openWorkspace(root);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    }, repo.root);
    await page.getByRole('button', { name: /^Revisão/ }).click();
    await page.getByRole('button', { name: 'Perfis de uso', exact: true }).click();
    await page.getByLabel('Nome do perfil').fill('Perfil de teste');
    await page.getByLabel('Perfil: Agente', { exact: true }).selectOption('fake');
    await page
      .getByLabel('Instruções do perfil')
      .fill('Preserve existing local edits. No commits or pushes.');
    await page.getByRole('button', { name: 'Salvar perfil', exact: true }).click();
    await expect(page.getByRole('button', { name: /Perfil de teste.*fake/ })).toBeVisible();
    const profileId = await page.evaluate(async () => {
      const r = await (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.snapshot();
      if (!r?.ok) throw new Error('workflow');
      return r.value.profiles[0]?.id ?? '';
    });
    await page.getByRole('button', { name: 'Voltar à IDE', exact: true }).click();
    await page.getByRole('button', { name: 'Nova tarefa', exact: true }).click();
    await page.getByLabel('Pasta', { exact: true }).fill(repo.root);
    await page.getByLabel('Perfil de uso', { exact: true }).selectOption(profileId);
    await page.getByLabel('Enunciado', { exact: true }).fill('Improve this fixture.');
    await page.getByRole('button', { name: 'Lançar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toHaveCount(0);
    const sourceId = await page.evaluate(async () => {
      const api = (window as unknown as { melinna: MelinnaApi }).melinna;
      const r = await api.workspace.snapshot();
      if (!r.ok) throw new Error('workspace');
      return r.value.executions.find((e) => !e.command)?.id ?? '';
    });
    const initial = await page.evaluate(async (id) => {
      const r = await (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.review(id);
      if (!r?.ok) throw new Error(r?.error.message);
      return r.value;
    }, sourceId);
    expect(initial.checkpoint?.reason).toBe('before-launch');
    expect(initial.task.prompt).toContain('Preserve existing local edits');
    expect(initial.notes.objective).toBe('Improve this fixture.');
    writeFileSync(join(repo.root, 'main.ts'), 'export const value = "agent change";\n');
    writeFileSync(join(repo.root, 'new.ts'), 'export const created = true;\n');
    await page.getByRole('button', { name: /^Revisão/ }).click();
    await page.getByLabel('Execução da tarefa', { exact: true }).selectOption(sourceId);
    await expect(page.locator('.workflow-change-list')).toContainText('main.ts');
    await page.getByRole('button', { name: /main.ts/ }).click();
    await expect(page.locator('.workflow-diff')).toContainText('user edit');
    await page.getByLabel('Notas: Decisões', { exact: true }).fill('Keep the existing component.');
    await page.getByLabel('Notas: Pendências', { exact: true }).fill('Review keyboard access.');
    await page.getByRole('button', { name: 'Salvar notas', exact: true }).click();
    const configId = await page.evaluate(
      async ({ groupId, root, node }) => {
        const api = (window as unknown as { melinna: MelinnaApi }).melinna;
        const r = await api.run.saveConfig(groupId, {
          name: 'Verificação fixture',
          tool: 'program',
          folder: root,
          script: null,
          program: node,
          args: ['-e', 'console.log("fixture verified");process.exit(0)'],
          runtimeOptions: '',
          env: [],
          beforeLaunch: null,
          allowParallel: false,
          folderGroup: null,
        });
        if (!r.ok) throw new Error(r.error.message);
        return r.value.id;
      },
      { groupId: group.id, root: repo.root, node: systemNode() },
    );
    // Refresh the config list via re-opening the view, as saved configurations are read on entry.
    await page.getByRole('button', { name: 'Voltar à IDE', exact: true }).click();
    await page.getByRole('button', { name: /^Revisão/ }).click();
    await page.getByLabel('Configuração para verificar', { exact: true }).selectOption(configId);
    await page.getByRole('button', { name: 'Executar verificação', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Executar verificação', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const r = await (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.review(id);
            return r?.ok ? r.value.verifications.at(-1)?.status : r?.error.message;
          }, sourceId),
        { timeout: 20000 },
      )
      .toBe('passed');
    await page.getByRole('button', { name: 'Passar para outro agente', exact: true }).click();
    await page.getByRole('button', { name: 'Preparar resumo com as notas', exact: true }).click();
    await expect(page.getByLabel('Resumo para o próximo agente')).toContainText(
      'Keep the existing component.',
    );
    const briefing = await page.getByLabel('Resumo para o próximo agente').inputValue();
    expect(briefing).toContain('Review keyboard access.');
    expect(briefing).toContain('passed');
    await page.getByLabel('Resumo para o próximo agente').fill(briefing + '\nUser reviewed this summary.');
    await page.getByLabel('Destino: Agente', { exact: true }).selectOption('fake-resume');
    await page.getByRole('button', { name: 'Enviar continuação', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Enviar continuação', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Revisar, verificar e continuar' })).toHaveCount(0);
    const targetId = await page.evaluate(async () => {
      const r = await (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.snapshot();
      if (!r?.ok) throw new Error('workflow');
      return r.value.handoffs.at(-1)?.targetExecutionId ?? '';
    });
    expect(targetId).toBeTruthy();
    expect(readFileSync(join(repo.root, 'main.ts'), 'utf8')).toContain('agent change');
    await page.getByRole('button', { name: /^Revisão/ }).click();
    await page.getByLabel('Execução da tarefa', { exact: true }).selectOption(sourceId);
    const guarded = await page.evaluate(
      async (checkpoint) =>
        (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.previewRestore(checkpoint),
      initial.checkpoint?.id ?? '',
    );
    expect(guarded?.ok).toBe(false);
    await page.getByRole('button', { name: 'Encerrar execuções para restaurar', exact: true }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Encerrar execuções nestas pastas', exact: true })
      .click();
    await expect
      .poll(
        async () =>
          page.evaluate(async (id) => {
            const r = await (window as unknown as { melinna: MelinnaApi }).melinna.workspace.snapshot();
            return r.ok ? r.value.executions.find((e) => e.id === id)?.status : '';
          }, targetId),
        { timeout: 15000 },
      )
      .toBe('exited');
    await page.getByRole('button', { name: 'Prévia da restauração', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: 'Confirmar restauração de arquivos' })).toContainText(
      'new.ts',
    );
    await page.getByRole('button', { name: 'Restaurar arquivos', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    expect(readFileSync(join(repo.root, 'main.ts'), 'utf8')).toBe('export const value = "user edit";\n');
    expect(existsSync(join(repo.root, 'new.ts'))).toBe(false);
    mkdirSync('test-results/workflow-artifacts', { recursive: true });
    await page.screenshot({ path: 'test-results/workflow-artifacts/review.png' });
    await app.close();
    app = await launchApp(userData);
    const restored = await app.page.evaluate(async () =>
      (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.snapshot(),
    );
    expect(restored?.ok).toBe(true);
    if (restored?.ok) {
      expect(restored.value.profiles[0]?.name).toBe('Perfil de teste');
      expect(restored.value.handoffs).toHaveLength(1);
      expect(restored.value.checkpoints.some((c) => c.reason === 'before-restore')).toBe(true);
      expect(restored.value.verifications[0]?.status).toBe('passed');
    }
  } catch (error) {
    const state = await app.page
      .evaluate(async () => (window as unknown as { melinna: MelinnaApi }).melinna.workflow?.snapshot())
      .catch(() => null);
    await test
      .info()
      .attach('workflow-state', { body: JSON.stringify(state, null, 2), contentType: 'application/json' });
    throw error;
  } finally {
    await app.close();
    cleanup(userData);
    repo.cleanup();
  }
});
