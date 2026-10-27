import { expect, test } from '@playwright/test';
import { createTempRepo, type TempRepo } from '../support/git-fixture';
import {
  cleanup,
  expectTerminalText,
  launchApp,
  makeUserData,
  readState,
  scrollbackText,
  waitFor,
  type E2eApp,
} from './harness';

let repo: TempRepo;
let userData: string;
let app: E2eApp | null = null;

test.beforeEach(() => {
  repo = createTempRepo();
  userData = makeUserData();
});

test.afterEach(async () => {
  await app?.close();
  cleanup(userData);
  repo.cleanup();
});

test('keep running on close, kill one agent outside, reopen with history, reattach and exit status', async () => {
  app = await launchApp(userData);
  const { page } = app;
  // uma tarefa por agente: os dois rodam direto na pasta do repositório
  for (const agent of ['fake', 'fake-pty']) {
    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    await page.getByLabel('Pasta').fill(repo.root);
    await page.getByLabel('Enunciado').fill('Fechar e reabrir');
    await page
      .getByRole('dialog', { name: 'Nova tarefa' })
      .getByRole('combobox', { name: /^Agente/ })
      .selectOption(agent);
    await page.getByRole('button', { name: 'Lançar', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toHaveCount(0);
  }
  await expect(page.locator('section.panel')).toHaveCount(2);
  await waitFor(() => {
    const t = Object.values(scrollbackText(userData));
    return t.length === 2 && t.every((x) => x.includes('pronto'));
  });

  // fechar a janela: o diálogo aparece e "Manter rodando" mantém os processos
  const proc = app.app.process();
  const closed = new Promise<void>((r) => (proc.exitCode !== null ? r() : proc.once('exit', () => r())));
  await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await page.getByRole('button', { name: 'Manter rodando em segundo plano' }).click();
  await closed;
  app = null;

  const state = await waitFor(() => {
    try {
      const s = readState(userData);
      return s.executions.length === 2 && s.executions.every((e) => e.pid) ? s : null;
    } catch {
      return null;
    }
  });
  const [keep, victim] = state.executions;
  expect(keep && victim).toBeTruthy();
  process.kill(victim!.pid!, 'SIGKILL');
  await new Promise((r) => setTimeout(r, 500));

  app = await launchApp(userData);
  const reopened = app.page;
  await expect(reopened.locator('section.panel')).toHaveCount(2);
  const keepPanel = reopened.getByTestId(`panel-${keep!.id}`);
  const victimPanel = reopened.getByTestId(`panel-${victim!.id}`);
  await expect(reopened.getByTestId(`tree-exec-status-${keep!.id}`)).toHaveText(/rodando|ocioso/);
  await expect(reopened.getByTestId(`tree-exec-status-${victim!.id}`)).toHaveText(
    process.platform === 'win32' ? 'encerrado (código 1)' : 'encerrado (sinal SIGKILL)',
  );

  // histórico nos dois painéis, vindo do disco e emendado ao vivo
  await expectTerminalText(reopened, keepPanel, 'pronto');
  await expectTerminalText(reopened, victimPanel, 'pronto');
  await expectTerminalText(
    reopened,
    victimPanel,
    process.platform === 'win32' ? 'processo encerrado (código 1)' : 'processo encerrado (sinal SIGKILL)',
  );

  await keepPanel.locator('.terminal-host').click();
  await reopened.keyboard.type('depois de reabrir');
  await reopened.keyboard.press('Enter');
  await expectTerminalText(reopened, keepPanel, 'echo:depois de reabrir');
  const text = scrollbackText(userData)[keep!.id] ?? '';
  // ConPTY can repaint earlier lines on resize; process identity proves reattach did not relaunch.
  expect(text).toContain('pronto');
  expect(readState(userData).executions.find((e) => e.id === keep!.id)?.pid).toBe(keep!.pid);
  await reopened.screenshot({ path: 'test-results/close-and-reopen.png' });
});
