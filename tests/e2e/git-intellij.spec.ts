import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { git } from '../support/git-fixture';
import { createRemoteFixture, type RemoteFixture } from '../support/git-remote-fixture';
import { cleanup, launchApp, makeUserData, waitFor, type E2eApp } from './harness';

let one: RemoteFixture;
let two: RemoteFixture;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  one = createRemoteFixture({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n' } });
  two = createRemoteFixture({ files: { 'x.txt': 'x\n', 'y.txt': 'y\n' } });
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  one.cleanup();
  two.cleanup();
});

test('commit one file of each of two git folders from the Commit panel and push from the branch menu', async () => {
  const { page } = app;
  writeFileSync(join(one.local.root, 'a.txt'), 'a2\n');
  writeFileSync(join(two.local.root, 'x.txt'), 'x2\n');

  // O diálogo nativo não é dirigível pelo Playwright: o principal devolve as duas pastas escolhidas.
  await app.app.evaluate(({ dialog }, folders) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: folders })) as typeof dialog.showOpenDialog;
  }, [one.local.root, two.local.root]);
  await page.getByRole('button', { name: 'Novo workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace' });
  await dialog.getByLabel('Nome').fill('Dois repos');
  await dialog.getByRole('button', { name: /Adicionar pastas/ }).click();
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo workspace' })).toHaveCount(0);

  // painel Commit: as duas pastas com a branch de cada uma, alterados já marcados
  await page.getByRole('button', { name: 'Commit (Alt+0)' }).click();
  await expect(page.getByRole('treeitem', { name: /Changes/ })).toBeVisible();
  await expect(page.getByLabel('Selecionar a.txt')).toBeChecked();
  await expect(page.getByLabel('Selecionar x.txt')).toBeChecked();
  await expect(page.getByTestId('commit-badge')).toHaveText('2');

  // diff ao lado do painel
  await page.getByText('a.txt', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'a.txt' })).toBeVisible();
  await expect(page.getByText('a2')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar diff' }).click();

  // um clique em Commit: um commit por repositório
  await page.getByLabel('Mensagem do commit').fill('Atualiza os dois');
  await page.getByRole('button', { name: 'Commit', exact: true }).click();
  await waitFor(() => git(one.local.root, ['log', '-1', '--format=%s']).trim() === 'Atualiza os dois');
  await waitFor(() => git(two.local.root, ['log', '-1', '--format=%s']).trim() === 'Atualiza os dois');
  expect(git(one.local.root, ['show', '--format=', '--name-only', 'HEAD']).trim()).toBe('a.txt');
  expect(git(two.local.root, ['show', '--format=', '--name-only', 'HEAD']).trim()).toBe('x.txt');

  // push pelo menu da branch, com a confirmação da principal
  await page.getByRole('button', { name: /^Branch main/ }).click();
  await page.getByRole('menuitem', { name: 'Push…' }).first().click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('branch principal');
  await confirm.getByRole('button', { name: 'Enviar' }).click();
  await waitFor(() => git(one.remote, ['log', '-1', '--format=%s', 'main']).trim() === 'Atualiza os dois');
  expect(git(two.remote, ['log', '-1', '--format=%s', 'main']).trim()).not.toBe('Atualiza os dois');
});
