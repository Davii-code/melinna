import { expect, test } from '@playwright/test';
import { createTempRepo, type TempRepo } from '../support/git-fixture';
import { cleanup, launchApp, makeUserData, scrollbackText, waitFor, type E2eApp } from './harness';

let repo: TempRepo;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  repo = createTempRepo();
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  repo.cleanup();
});

test('launch fake and fake-pty, type in each panel and see the echo', async () => {
  const { page } = app;
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByLabel('Nome do novo grupo').fill('Grupo e2e');
  await page.getByLabel('Repositório').fill(repo.root);
  await page.getByLabel('Ponto de partida').fill('main');
  await page.getByLabel('Enunciado').fill('Tarefa de ponta a ponta');
  await page.getByTestId('agent-fake').getByRole('checkbox').check();
  await page.getByTestId('agent-fake-pty').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lançar' }).click();

  const panels = page.locator('section.panel');
  await expect(panels).toHaveCount(2);
  await expect(page.getByTestId('panel-status').first()).toHaveText(/rodando|ocioso/);

  // cada execução recebeu o enunciado (argumento ou PTY)
  await waitFor(() => {
    const texts = Object.values(scrollbackText(userData));
    return (
      texts.length === 2 &&
      texts.every((t) => t.includes('pronto')) &&
      texts.some((t) => t.includes('echo:Tarefa de ponta a ponta'))
    );
  });

  const terminals = page.locator('.terminal-host');
  for (let i = 0; i < 2; i++) {
    await terminals.nth(i).click();
    await page.keyboard.type(`ola painel ${i}`);
    await page.keyboard.press('Enter');
  }
  await waitFor(() => {
    const all = Object.values(scrollbackText(userData)).join('\n');
    return all.includes('echo:ola painel 0') && all.includes('echo:ola painel 1');
  });
  const byExec = Object.values(scrollbackText(userData));
  expect(byExec.filter((t) => t.includes('echo:ola painel')).length).toBe(2);
  await page.screenshot({ path: 'test-results/launch-and-converse.png' });
});
