import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { removeDirRecursive } from '../support/temp-dirs';
import { cleanup, launchApp, makeUserData, waitFor, type E2eApp } from './harness';

const NODE_APP = join(__dirname, '..', 'fixtures', 'projects', 'node-app');

let project: string;
let userData: string;
let app: E2eApp;

test.beforeEach(async () => {
  project = mkdtempSync(join(tmpdir(), 'melinna-runcfg-'));
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

const selectorButton = () => app.page.getByRole('button', { name: /Configuração de execução/ });

/** Abre a janela de configurações pelo seletor. */
async function openConfigsDialog() {
  await selectorButton().click();
  await app.page.getByRole('button', { name: 'Editar configurações…' }).click();
  return app.page.getByRole('dialog', { name: 'Configurações de execução' });
}

/** Cria e ativa uma configuração a partir de um script detectado, pelo seletor. */
async function addFromDetected(script: string) {
  const { page } = app;
  await selectorButton().click();
  await page.getByRole('button', { name: 'Adicionar a partir de um script detectado…' }).click();
  await page
    .getByRole('dialog', { name: 'Scripts detectados' })
    .getByRole('button', { name: script, exact: true })
    .click();
  await expect(selectorButton()).toContainText(script);
}

function stateText(): string {
  try {
    return readFileSync(join(userData, 'state.json'), 'utf8');
  } catch {
    return '';
  }
}

test('create a config from the "start" script with PORT=4000, save it, reopen the app and see it', async () => {
  const { page } = app;
  await openProjectWorkspace();
  const dialog = await openConfigsDialog();

  await dialog.getByRole('button', { name: 'Adicionar configuração' }).click();
  await page.getByRole('menuitem', { name: /^start \(/ }).click();
  await expect(dialog.getByLabel('Nome', { exact: true })).toHaveValue('start');

  await dialog.getByRole('button', { name: 'Adicionar variável' }).click();
  await dialog.getByLabel('Nome da variável 1').fill('PORT');
  await dialog.getByLabel('Valor de PORT').fill('4000');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Configurações de execução' })).toHaveCount(0);

  await selectorButton().click();
  await expect(page.getByRole('option', { name: /^start/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'test-results/run-configs-saved.png' });

  // o estado é gravado de forma atômica logo depois da mudança; reabre o app com a mesma pasta de dados
  await waitFor(() => stateText().includes('"runConfigs"') && stateText().includes('"PORT"'));
  await app.close();
  app = await launchApp(userData);

  await selectorButton().click();
  await expect(app.page.getByRole('option', { name: /^start/ })).toBeVisible();
  await app.page.keyboard.press('Escape');
  const reopened = await openConfigsDialog();
  await reopened.getByRole('treeitem', { name: 'start', exact: true }).click();
  await expect(reopened.getByLabel('Valor de PORT')).toHaveValue('4000');
});

test('run the saved config with PORT=4000 and see the port in the terminal', async () => {
  const { page } = app;
  await openProjectWorkspace();
  const dialog = await openConfigsDialog();
  await dialog.getByRole('button', { name: 'Adicionar configuração' }).click();
  await page.getByRole('menuitem', { name: /^start \(/ }).click();
  await dialog.getByRole('button', { name: 'Adicionar variável' }).click();
  await dialog.getByLabel('Nome da variável 1').fill('PORT');
  await dialog.getByLabel('Valor de PORT').fill('4000');
  await dialog.getByRole('button', { name: 'Rodar' }).click();

  await expect(page.locator('section.panel')).toHaveCount(1);
  await expect(page.locator('section.panel .xterm-rows')).toContainText('PORT=4000');
});

test('the selector lists only the saved configs, not the detected scripts', async () => {
  const { page } = app;
  await openProjectWorkspace();
  await selectorButton().click();
  await expect(page.getByText('Nenhuma configuração')).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await addFromDetected('dev');
  await selectorButton().click();
  await expect(page.getByRole('option')).toHaveCount(1);
});

test('a "Antes de lançar" step that fails keeps the main config from launching', async () => {
  const { page } = app;
  await openProjectWorkspace();
  await addFromDetected('fail');
  await addFromDetected('dev');

  const dialog = await openConfigsDialog();
  await dialog.getByRole('treeitem', { name: 'dev', exact: true }).click();
  await dialog.getByLabel('Antes de lançar').selectOption({ label: 'fail' });
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('dialog', { name: 'Configurações de execução' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Rodar', exact: true }).click();
  await expect(page.getByText(/terminou com código 1/)).toBeVisible();
  // só a etapa foi lançada: a principal ("servidor de exemplo no ar") nunca roda
  await expect(page.locator('section.panel')).toHaveCount(1);
  await expect(page.locator('section.panel .xterm-rows')).not.toContainText('servidor de exemplo no ar');
});
