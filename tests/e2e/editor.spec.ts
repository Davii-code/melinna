import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createTempRepo } from '../support/git-fixture';
import { removeDirRecursive } from '../support/temp-dirs';
import { cleanup, launchApp, makeUserData, type E2eApp } from './harness';

const extraCleanup: (() => void)[] = [];
let project: string;
let userData: string;
let app: E2eApp;

const LONG = Array.from({ length: 200 }, (_, i) => `const linha${i + 1} = ${i + 1};`).join('\n');
const MAIN = [
  'export function soma(a: number, b: number) {',
  '  return a + b;',
  '}',
  '',
  'export class Servico {',
  '  iniciar() {',
  '    return soma(1, 2);',
  '  }',
  '}',
  '',
  'const alvo = 1;',
  'const outro = alvo + alvo;',
  '',
].join('\n');

test.beforeEach(async () => {
  project = realpathSync.native(mkdtempSync(join(tmpdir(), 'melinna-editor-')));
  mkdirSync(join(project, 'src'));
  writeFileSync(join(project, 'src', 'main.ts'), MAIN);
  writeFileSync(join(project, 'src', 'longo.ts'), LONG);
  writeFileSync(
    join(project, 'src', 'usa.ts'),
    'import { soma } from "./main";\nexport const total = soma(2, 3);\n',
  );
  userData = makeUserData();
  app = await launchApp(userData);
});

test.afterEach(async () => {
  await app.close();
  cleanup(userData);
  for (const dispose of extraCleanup.splice(0)) dispose();
  removeDirRecursive(project);
});

async function openWorkspace(folder: string = project) {
  const { page } = app;
  await app.app.evaluate(
    ({ dialog }, folders) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: folders,
      })) as typeof dialog.showOpenDialog;
    },
    [folder],
  );
  await page.getByRole('button', { name: 'Novo workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Novo workspace' });
  await dialog.getByLabel('Nome').fill('Editor');
  await dialog.getByRole('button', { name: /Adicionar pastas/ }).click();
  await dialog.getByRole('button', { name: 'Criar workspace' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo workspace' })).toHaveCount(0);
}

/** Abre o arquivo por "Ir para arquivo" (Ctrl+P no mapa Windows) e espera o editor. */
async function openFile(name: string) {
  const { page } = app;
  await page.keyboard.press('Control+P');
  await page.getByLabel('Filtrar arquivos').fill(name);
  await page.getByRole('dialog', { name: 'Ir para arquivo' }).getByRole('option').first().click();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await page.locator('.cm-content').click();
}

const cursorLine = () =>
  app.page.evaluate(() => {
    const active = document.querySelector(
      '.editor-document:not(.editor-document-hidden) .cm-activeLineGutter',
    );
    return active?.textContent ?? '';
  });

test('go to line 120:5 in a long file', async () => {
  const { page } = app;
  await openWorkspace();
  await openFile('longo.ts');
  await page.keyboard.press('Control+G');
  const popup = page.getByRole('dialog', { name: 'Ir para linha' });
  await popup.getByLabel('Linha[:coluna]').fill('120:5');
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  await expect.poll(cursorLine).toBe('120');
});

test('go to a symbol from the file structure', async () => {
  const { page } = app;
  await openWorkspace();
  await openFile('main.ts');
  await page.keyboard.press('Control+F12');
  const popup = page.getByRole('dialog', { name: 'Estrutura do arquivo' });
  await expect(popup.getByRole('option')).toHaveCount(3);
  await popup.getByLabel('Filtrar símbolos').fill('inic');
  await page.keyboard.press('Enter');
  await expect(popup).toHaveCount(0);
  await expect.poll(cursorLine).toBe('6');
});

test('select the next occurrences and type in all of them; the tab stays unsaved until saving', async () => {
  const { page } = app;
  await openWorkspace();
  await openFile('main.ts');
  await page.keyboard.press('Control+G');
  await page.getByLabel('Linha[:coluna]').fill('11:8');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+D');
  await page.keyboard.press('Control+D');
  await page.keyboard.press('Control+D');
  await page.keyboard.type('meta');
  await expect(page.locator('.cm-content')).toContainText('const meta = 1;');
  await expect(page.locator('.cm-content')).toContainText('const outro = meta + meta;');
  await expect(page.getByLabel('não salvo')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.cm-content')).toContainText('const outro = alvo + alvo;');
});

test('search in the project and open a result at its line', async () => {
  const { page } = app;
  await openWorkspace();
  await openFile('main.ts');
  await page.keyboard.press('Control+Shift+F');
  const popup = page.getByRole('dialog', { name: 'Buscar no projeto' });
  await popup.getByLabel('Texto da busca').fill('soma(2');
  const results = popup.getByRole('listbox', { name: 'Resultados' });
  await expect(results.getByRole('option')).toHaveCount(1);
  await results.getByRole('option').first().click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'usa.ts' })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(cursorLine).toBe('2');
  await page.screenshot({ path: 'test-results/editor-search.png' });
});

test('split right, edit on both sides, see the git marks, revert a block and save once', async () => {
  const { page } = app;
  const repo = createTempRepo({ files: { 'src/a.ts': 'um\ndois\ntres\nquatro\n' } });
  try {
    writeFileSync(join(repo.root, 'src', 'a.ts'), 'UM\ndois\nquatro\n');
    await openWorkspace(repo.root);
    await openFile('a.ts');

    // margem do git: linha 1 alterada, "tres" removida
    const marks = page.locator('.cm-git-gutter .git-mark');
    await expect(page.locator('.cm-git-gutter [aria-label="Linhas alteradas"]').first()).toBeVisible();
    await expect(page.locator('.cm-git-gutter [aria-label="Linhas removidas"]').first()).toBeVisible();
    expect(await marks.count()).toBeGreaterThanOrEqual(2);

    // dividir à direita pelo menu da aba
    await page.getByRole('tab', { name: 'a.ts' }).click({ button: 'right' });
    await page
      .getByRole('menu', { name: 'Menu da aba' })
      .getByRole('menuitem', { name: 'Dividir à direita' })
      .click();
    await expect(page.locator('.cm-editor')).toHaveCount(2);

    // edita de um lado e vê do outro; a aba fica não salva nos dois
    await page.locator('.cm-content').nth(1).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('cinco');
    await expect(page.locator('.cm-content').nth(0)).toContainText('cinco');
    await expect(page.getByLabel('não salvo')).toHaveCount(2);

    // reverter o trecho alterado (linha 1) pela margem
    await page.locator('.cm-git-gutter [aria-label="Linhas alteradas"]').first().click();
    await page
      .getByRole('dialog', { name: 'Trecho original' })
      .getByRole('button', { name: 'Reverter este trecho' })
      .click();
    await expect(page.locator('.cm-content').nth(1)).toContainText('um');
    await expect(page.locator('.cm-content').nth(0)).not.toContainText('UM');
    expect(readFileSync(join(repo.root, 'src', 'a.ts'), 'utf8')).toBe('UM\ndois\nquatro\n');

    // salvar uma vez grava o texto da aba no disco
    await page.keyboard.press('Control+S');
    await expect(page.getByLabel('não salvo')).toHaveCount(0);
    expect(readFileSync(join(repo.root, 'src', 'a.ts'), 'utf8')).toBe('um\ndois\nquatro\ncinco');
    await page.screenshot({ path: 'test-results/editor-split-git.png' });
  } finally {
    extraCleanup.push(() => repo.cleanup());
  }
});
