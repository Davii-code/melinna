import { expect, test } from '@playwright/test';
import { createTempRepo, type TempRepo } from '../support/git-fixture';
import { cleanup, launchApp, makeUserData, scrollbackText, waitFor, type E2eApp } from './harness';

let main: TempRepo;
let extra: TempRepo;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  main = createTempRepo();
  extra = createTempRepo();
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  main.cleanup();
  extra.cleanup();
});

test('create a workspace with two folders and open an agent that receives --add-dir', async () => {
  const { page } = app;
  // O diálogo nativo não é dirigível pelo Playwright: o principal devolve as duas pastas escolhidas.
  await app.app.evaluate(({ dialog }, folders) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: folders })) as typeof dialog.showOpenDialog;
  }, [main.root, extra.root]);

  await page.getByRole('button', { name: 'Novo workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace' });
  await dialog.getByLabel('Nome').fill('Duas pastas');
  await dialog.getByRole('button', { name: /Adicionar pastas/ }).click();
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('radio').first()).toBeChecked();
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo workspace' })).toHaveCount(0);
  await expect(page.getByTestId(/^tree-group-name-/)).toHaveText('Duas pastas');

  await page.getByRole('button', { name: 'Nova sessão em Duas pastas' }).click();
  await page.getByRole('menuitem', { name: 'Agente falso', exact: true }).click();

  const quoted = (path: string) => JSON.stringify(path).slice(1, -1);
  const text = await waitFor(() => {
    const all = Object.values(scrollbackText(userData)).join('\n');
    return all.includes('pronto') && all.includes('--add-dir') ? all : undefined;
  });
  expect(text).toContain(quoted(extra.root));
  // o terminal abre na pasta principal: ela é o cwd, então não aparece como pasta extra
  expect(text).not.toContain(`"--add-dir","${quoted(main.root)}"`);
  await expect(page.locator('[data-testid^="tree-exec-notice-"]')).toHaveCount(0);
});
