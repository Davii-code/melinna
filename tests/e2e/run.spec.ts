import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { cleanup, launchApp, makeUserData, type E2eApp } from './harness';
import { removeDirRecursive } from '../support/temp-dirs';

const NODE_APP = join(__dirname, '..', 'fixtures', 'projects', 'node-app');

let project: string;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'melinna-run-'));
  cpSync(NODE_APP, project, { recursive: true });
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  removeDirRecursive(project);
});

async function openProjectWorkspace() {
  const { page } = app;
  // O diálogo nativo não é dirigível pelo Playwright: o principal devolve a pasta escolhida.
  await app.app.evaluate(
    ({ dialog }, folders) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: folders,
      })) as typeof dialog.showOpenDialog;
    },
    [project],
  );
  await page.getByRole('button', { name: 'Novo workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace' });
  await dialog.getByLabel('Nome').fill('Exemplo');
  await dialog.getByRole('button', { name: /Adicionar pastas/ }).click();
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo workspace' })).toHaveCount(0);
}

test('choose "dev" of the node-app, run it and see the output', async () => {
  const { page } = app;
  await openProjectWorkspace();

  const play = page.getByRole('button', { name: 'Rodar', exact: true });
  await expect(play).toBeDisabled();
  // o seletor lista só as configurações salvas: cria a de `dev` a partir do script detectado
  await page.getByRole('button', { name: /Configuração de execução/ }).click();
  await page.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }).click();
  await page
    .getByRole('dialog', { name: 'Scripts detectados' })
    .getByRole('button', { name: 'dev', exact: true })
    .click();
  await expect(page.getByRole('button', { name: /Configuração de execução/ })).toContainText('dev');

  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.locator('section.panel')).toHaveCount(1);
  await expect(page.locator('section.panel .xterm-rows')).toContainText('servidor de exemplo no ar');
  await expect(page.getByTestId('run-running')).toBeVisible();

  // pelo menu: rodar de novo e parar
  await page.getByRole('button', { name: 'Mais ações de execução' }).click();
  await page.getByRole('menuitem', { name: 'Parar' }).click();
  await expect(page.getByTestId('run-running')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/run-bar.png' });
});

test('switch to the IntelliJ map and open "go to file" with Ctrl+Shift+N', async () => {
  const { page } = app;
  await openProjectWorkspace();

  await page.getByRole('button', { name: 'Atalhos' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mapa de atalhos' });
  await dialog.getByRole('radio', { name: /IntelliJ IDEA/ }).check();
  await dialog.getByRole('button', { name: 'Fechar' }).click();

  await page.keyboard.press('Control+Shift+N');
  await expect(page.getByLabel('Filtrar arquivos')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Filtrar arquivos')).toHaveCount(0);

  // o atalho do mapa anterior deixou de valer
  await page.keyboard.press('Control+P');
  await expect(page.getByLabel('Filtrar arquivos')).toHaveCount(0);

  // voltar ao Windows: Ctrl+P abre
  await page.getByRole('button', { name: 'Atalhos' }).click();
  await page
    .getByRole('dialog', { name: 'Mapa de atalhos' })
    .getByRole('radio', { name: /Windows/ })
    .check();
  await page.getByRole('dialog', { name: 'Mapa de atalhos' }).getByRole('button', { name: 'Fechar' }).click();
  await page.keyboard.press('Control+P');
  await expect(page.getByLabel('Filtrar arquivos')).toBeVisible();
});
