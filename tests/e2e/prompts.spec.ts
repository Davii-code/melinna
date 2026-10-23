import { basename } from 'node:path';
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

test('create a prompt with a variable and send it to two sessions of the fake agent', async () => {
  const { page } = app;
  // duas sessões do agente falso, as duas na pasta do repositório
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Nova tarefa' }).click();
    await page.getByLabel('Pasta').fill(repo.root);
    await page.getByLabel('Agente').selectOption('fake');
    await page.getByRole('button', { name: 'Lançar' }).click();
    await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toHaveCount(0);
  }
  await expect(page.locator('section.panel')).toHaveCount(2);
  await waitFor(() => {
    const texts = Object.values(scrollbackText(userData));
    return texts.length === 2 && texts.every((t) => t.includes('pronto'));
  });

  // Ctrl+Shift+P com o terminal em foco abre a biblioteca e a tecla não chega ao PTY
  await page.locator('.terminal-host').first().click();
  await page.keyboard.press('Control+Shift+P');
  const library = page.getByRole('dialog', { name: 'Biblioteca de prompts' });
  await expect(library).toBeVisible();

  await library.getByRole('button', { name: 'Novo prompt' }).click();
  await library.getByLabel('Nome').fill('Revisar');
  await library.getByLabel('Texto').fill('Olá {{nome}}, revise {{pasta}}');
  await expect(library.getByText('Variáveis: {{nome}}, {{pasta}}')).toBeVisible();
  await library.getByRole('button', { name: 'Salvar' }).click();
  await expect(library.getByText('Revisar', { exact: true })).toBeVisible();

  await library.getByRole('button', { name: 'Usar' }).click();
  const use = page.getByRole('dialog', { name: 'Usar prompt Revisar' });
  await use.getByLabel('nome', { exact: true }).fill('Ana');
  await expect(use.getByText('Preenchidas sozinhas: {{pasta}}')).toBeVisible();
  await use.getByRole('radio', { name: 'Várias sessões' }).check();
  const boxes = use.getByRole('group', { name: 'Sessões de destino' }).getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await use.getByRole('button', { name: 'Enviar' }).click();

  const confirm = page.getByRole('alertdialog', { name: 'Enviar para 2 sessões?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Confirmar envio' }).click();

  const result = use.getByRole('region', { name: 'Resultado do envio' });
  await expect(result.getByRole('listitem')).toHaveCount(2);
  await expect(result.getByText('Enviado')).toHaveCount(2);
  await use.getByRole('button', { name: 'Fechar' }).click();
  await expect(page.getByRole('dialog', { name: 'Usar prompt Revisar' })).toHaveCount(0);
  await expect(page.getByText('Prompt enviado para 2 sessões.')).toBeVisible();

  // as duas sessões receberam o texto já resolvido, cada uma com a própria pasta, e só ele
  const received = await waitFor(() => {
    const texts = Object.values(scrollbackText(userData));
    return texts.every((t) => t.includes('echo:Olá Ana, revise ')) ? texts : undefined;
  });
  for (const text of received) {
    expect(text).toContain(basename(repo.root));
    expect(text).not.toContain('{{');
    expect(text.match(/echo:/g)).toHaveLength(1);
  }
});
