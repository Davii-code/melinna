import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createTempRepo, type TempRepo } from '../support/git-fixture';
import { removeDirRecursive } from '../support/temp-dirs';
import { cleanup, launchApp, makeUserData, scrollbackText, waitFor, type E2eApp } from './harness';

// PNG 1x1 válido (a miniatura do Electron precisa decodificar o arquivo).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let repo: TempRepo;
let userData: string;
let images: string;
let app: E2eApp;

test.beforeEach(async () => {
  repo = createTempRepo();
  userData = makeUserData();
  images = mkdtempSync(join(tmpdir(), 'melinna-e2e-img-'));
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  repo.cleanup();
  removeDirRecursive(images);
});

test('attach a PNG to the fake agent, send it and see the path echoed', async () => {
  const { page } = app;
  const png = join(images, 'print.png');
  writeFileSync(png, PNG_1X1);
  // Soltar arquivo de verdade não é reproduzível pelo Playwright (o caminho real vem do Electron) e o
  // diálogo nativo não é dirigível: o principal devolve o arquivo escolhido.
  await app.app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as typeof dialog.showOpenDialog;
  }, [png]);

  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByLabel('Pasta').fill(repo.root);
  await page.getByLabel('Agente').selectOption('fake');
  await page.getByRole('button', { name: 'Lançar' }).click();
  await expect(page.locator('section.panel')).toHaveCount(1);
  await waitFor(() => Object.values(scrollbackText(userData)).some((t) => t.includes('pronto')));

  await page.locator('section.panel').getByRole('button', { name: 'Anexar imagem', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Anexar imagem' });
  await expect(preview.getByRole('img', { name: 'print.png' })).toBeVisible();
  // nada foi escrito no terminal antes de confirmar
  expect(Object.values(scrollbackText(userData)).join('')).not.toContain(png);
  await preview.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('dialog', { name: 'Anexar imagem' })).toHaveCount(0);

  // a referência foi digitada no prompt, sem Enter: o eco só aparece depois do Enter do usuário
  await page.locator('.terminal-host').first().click();
  await page.keyboard.press('Enter');
  await waitFor(() => Object.values(scrollbackText(userData)).join('\n').includes(`echo:${png}`));
});
