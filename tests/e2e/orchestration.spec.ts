import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { MelinnaApi } from '../../src/shared/ipc-contract';
import { DEFAULT_TEAM } from '../../src/core/orchestration/types';
import { createTempRepo } from '../support/git-fixture';
import { orchestrationCatalog } from '../support/orchestration-catalog';
import { cleanup, launchApp, makeUserData } from './harness';

test('visual team: real IPC, structured child processes, cross-provider delegation, patch and recovery', async () => {
  test.setTimeout(120000);
  const repo = createTempRepo();
  const userData = makeUserData();
  writeFileSync(join(userData, 'catalog.json'), orchestrationCatalog(userData));
  let app = await launchApp(userData);
  try {
    const { page } = app;
    const groupId = await page.evaluate(async (root) => {
      const api = (window as unknown as { melinna: MelinnaApi }).melinna;
      const reply = await api.workspace.openWorkspace(root);
      if (!reply.ok) throw new Error(reply.error.message);
      return reply.value.id;
    }, repo.root);
    const versions = await page.evaluate(async (team) => {
      const reply = await (window as unknown as { melinna: MelinnaApi }).melinna.orchestration?.preflight(
        team,
      );
      if (!reply?.ok) throw new Error('fake preflight failed');
      return reply.value;
    }, structuredClone(DEFAULT_TEAM));
    expect(versions.every((item) => item.available && item.version?.startsWith('melinna-fake-agent'))).toBe(
      true,
    );
    await page.getByRole('button', { name: 'Equipes', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Um objetivo. Uma equipe.' })).toBeVisible();
    await page.getByLabel('Nome da equipe', { exact: true }).fill('Equipe de regressão');
    await page.getByRole('button', { name: 'Salvar equipe', exact: true }).click();
    await page.getByLabel('Workspace', { exact: true }).selectOption(groupId);
    await page.getByLabel('O que a equipe deve fazer?').fill('Run the deterministic fake-agent regression.');
    await page.getByRole('button', { name: 'Iniciar orquestração', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Conversa com o coordenador' })
        .getByText('Equipe finalizada: Claude e Codex responderam.', { exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.team-job')).toHaveCount(2);
    await page.locator('.team-job').filter({ hasText: 'developer' }).click();
    await expect(page.getByRole('log', { name: 'Console de eventos da sessão' })).toBeVisible();
    await page.getByRole('button', { name: 'Revisar alterações' }).click();
    await expect(page.locator('.team-patch pre')).toContainText('worker-result.txt');
    await page.getByRole('button', { name: 'Aplicar ao workspace' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Aplicar patch', exact: true }).click();
    await expect(page.locator('.team-patch')).toHaveCount(0);
    const state = await page.evaluate(async () => {
      const api = (window as unknown as { melinna: MelinnaApi }).melinna;
      const reply = await api.orchestration?.snapshot();
      if (!reply?.ok) throw new Error('snapshot');
      return reply.value;
    });
    expect(state.runs[0]?.jobs.every((job) => job.status === 'succeeded')).toBe(true);
    expect(state.runs[0]?.jobs.some((job) => job.patchApplied)).toBe(true);
    // Invert the coordinator provider and repeat through the same bridge.
    await page.evaluate(
      async ({ team, groupId }) => {
        const api = (window as unknown as { melinna: MelinnaApi }).melinna;
        if (!api.orchestration) throw new Error('api');
        const saved = await api.orchestration.saveTeam(team);
        if (!saved.ok) throw new Error(saved.error.message);
        const started = await api.orchestration.start({
          teamId: saved.value.id,
          groupId,
          prompt: 'Codex coordinator delegates to Claude and Codex fixtures.',
        });
        if (!started.ok) throw new Error(started.error.message);
      },
      {
        team: {
          ...structuredClone(DEFAULT_TEAM),
          id: '',
          name: 'Codex coordena',
          coordinator: { ...DEFAULT_TEAM.coordinator, provider: 'codex' as const },
        },
        groupId,
      },
    );
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const reply = await (
              window as unknown as { melinna: MelinnaApi }
            ).melinna.orchestration?.snapshot();
            return reply?.ok ? reply.value.runs[0]?.status : 'error';
          }),
        { timeout: 45000 },
      )
      .toBe('succeeded');
    mkdirSync('test-results/orchestration-artifacts', { recursive: true });
    await page.screenshot({ path: 'test-results/orchestration-artifacts/visual-team.png' });
    await app.close();
    app = await launchApp(userData);
    const recovered = await app.page.evaluate(async () => {
      const reply = await (window as unknown as { melinna: MelinnaApi }).melinna.orchestration?.snapshot();
      return reply?.ok ? reply.value : null;
    });
    expect(recovered?.runs).toHaveLength(2);
    expect(recovered?.runs.every((run) => run.status === 'succeeded')).toBe(true);
  } catch (error) {
    const state = await app.page
      .evaluate(async () => (window as unknown as { melinna: MelinnaApi }).melinna.orchestration?.snapshot())
      .catch(() => null);
    await test
      .info()
      .attach('orchestration-state', {
        body: JSON.stringify(state, null, 2),
        contentType: 'application/json',
      });
    throw error;
  } finally {
    await app.page
      .evaluate(async () => {
        const api = (window as unknown as { melinna: MelinnaApi }).melinna;
        const state = await api.orchestration?.snapshot();
        if (state?.ok)
          for (const run of state.value.runs)
            if (['running', 'paused', 'waiting_user'].includes(run.status))
              await api.orchestration?.control(run.id, 'cancel');
      })
      .catch(() => undefined);
    await app.close();
    cleanup(userData);
    repo.cleanup();
  }
});
