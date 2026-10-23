import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { git } from '../support/git-fixture';
import { createRemoteFixture, type RemoteFixture } from '../support/git-remote-fixture';
import { cleanup, launchApp, makeUserData, waitFor, type E2eApp } from './harness';

let fx: RemoteFixture;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  fx = createRemoteFixture({ files: { 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'c\n' } });
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  fx.cleanup();
});

test('commit two of three files and push them to a local bare remote from the interface', async () => {
  const { page } = app;
  const root = fx.local.root;
  writeFileSync(join(root, 'a.txt'), 'a2\n');
  writeFileSync(join(root, 'b.txt'), 'b2\n');
  writeFileSync(join(root, 'c.txt'), 'c2\n');

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByLabel('Pasta').fill(root);
  await page.getByLabel('Agente').selectOption('fake');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toHaveCount(0);

  const bar = page.getByRole('group', { name: /^Git de / });
  await expect(bar.getByRole('button', { name: /Branch main/ })).toBeVisible();
  await bar.getByRole('button', { name: 'Commit' }).click();

  const dialog = page.getByRole('dialog', { name: /^Commit:/ });
  await expect(dialog.getByLabel('Selecionar a.txt')).toBeChecked();
  await expect(dialog.getByLabel('Selecionar c.txt')).toBeChecked();
  await expect(dialog.getByRole('status')).toContainText('agente');
  await dialog.getByLabel('Selecionar c.txt').uncheck();
  await dialog.getByRole('button', { name: 'Ver diff de a.txt' }).click();
  await expect(dialog.getByText('a2')).toBeVisible();
  await dialog.getByLabel('Mensagem do commit').fill('Atualiza a e b\n\nSem mexer no c');
  await dialog.getByRole('button', { name: 'Commit e push' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('branch principal');
  await confirm.getByRole('button', { name: 'Enviar' }).click();

  await waitFor(() => git(fx.remote, ['log', '-1', '--format=%s', 'main']).trim() === 'Atualiza a e b');
  expect(git(fx.remote, ['show', '--format=', '--name-only', 'main']).trim().split('\n').sort()).toEqual([
    'a.txt',
    'b.txt',
  ]);
  expect(git(root, ['status', '--porcelain']).trim()).toBe('M c.txt');
  await expect(bar.getByText('↑0')).toBeVisible();
});
