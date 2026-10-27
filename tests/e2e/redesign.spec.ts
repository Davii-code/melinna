import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MelinnaApi } from '../../src/shared/ipc-contract';
import { expect, test } from '@playwright/test';
import { createTempRepo } from '../support/git-fixture';
import { cleanup, launchApp, makeUserData, scrollbackText, waitFor } from './harness';

/** Real Electron/PTY regression; no user workspace or agent account is touched. */
test('prism workspace: parallel terminals, development, focus, split, home and restore', async () => {
  test.setTimeout(120_000);
  const baseline = process.env.MELINNA_CAPTURE_BASELINE === '1';
  const prefix = baseline ? 'before' : 'after';
  const repo = createTempRepo({
    files: {
      'main.ts': [
        'export interface AgentSession {',
        '  id: string;',
        "  status: 'running' | 'idle';",
        '}',
        '',
        'export const sessions: AgentSession[] = [];',
        '',
        'export function activeSessions() {',
        "  return sessions.filter((session) => session.status === 'running');",
        '}',
        '',
        '// Each agent keeps an independent PTY and scrollback.',
        'export const answer = 42;',
        '',
      ].join('\n'),
      'other.ts': 'export const other = true;\n',
    },
  });
  const userData = makeUserData();
  let app = await launchApp(userData);
  const captures = 'docs/redesign/screenshots';
  mkdirSync(captures, { recursive: true });
  try {
    const { page } = app;
    await app.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1586, 1000);
    });
    await page.screenshot({ path: join(captures, prefix + '-home.png') });
    await page.evaluate(async (folder) => {
      await (window as unknown as { melinna: MelinnaApi }).melinna.workspace.openWorkspace(folder);
    }, repo.root);
    for (const agent of ['fake', 'fake-pty']) {
      await page.getByRole('button', { name: 'Nova tarefa' }).click();
      await page.getByLabel('Pasta', { exact: true }).fill(repo.root);
      await page.getByLabel('Enunciado').fill('Prism regression');
      await page
        .getByRole('dialog', { name: 'Nova tarefa' })
        .getByRole('combobox', { name: /^Agente/ })
        .selectOption(agent);
      await page.getByRole('button', { name: 'Lançar', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Nova tarefa' })).toHaveCount(0);
    }
    await expect(page.locator('.terminal-host')).toHaveCount(2);
    await waitFor(
      () => Object.values(scrollbackText(userData)).filter((s) => s.includes('pronto')).length === 2,
    );
    for (let i = 0; i < 2; i++) {
      await page.locator('.terminal-host').nth(i).click();
      await page.keyboard.type('prism-' + i);
      await page.keyboard.press('Enter');
    }
    await waitFor(() => Object.values(scrollbackText(userData)).join('').includes('echo:prism-1'));
    await page.keyboard.press('Control+P');
    await page.getByLabel('Filtrar arquivos').fill('main.ts');
    await page.getByRole('dialog', { name: 'Ir para arquivo' }).getByRole('option').first().click();
    await expect(page.locator('.cm-editor')).toBeVisible();
    await page.screenshot({ path: join(captures, prefix + '-development.png') });
    if (!baseline) {
      await page.getByRole('button', { name: 'Arquivos (Alt+2)', exact: true }).click();
      await expect(page.locator('.files')).toBeVisible();
      await page.screenshot({ path: join(captures, 'after-development-files.png') });
      await page.getByRole('button', { name: 'Workspaces (Alt+1)', exact: true }).click();
      await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1366, 768));
      await page.screenshot({ path: join(captures, 'after-1366x768.png') });
      const widthBeforeZoom = await page.evaluate(() => window.innerWidth);
      await app.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25),
      );
      await expect.poll(async () => page.evaluate(() => window.innerWidth)).toBeLessThan(widthBeforeZoom);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
      );
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const bar = document.querySelector('.topbar');
            return bar ? bar.getBoundingClientRect().right <= window.innerWidth : false;
          }),
        )
        .toBe(true);
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const grid = document.querySelector<HTMLElement>('.grid');
            const content = grid?.querySelector<HTMLElement>('.grid-content');
            return !!grid && !!content && Math.abs(content.offsetWidth - Math.max(grid.clientWidth, 664)) < 2;
          }),
        )
        .toBe(true);
      // Electron's page screenshot clips at CSS dimensions after native webContents zoom.
      const zoomCapture = await app.app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        if (!window) throw new Error('Missing Electron window');
        return (await window.webContents.capturePage()).toPNG().toString('base64');
      });
      writeFileSync(join(captures, 'after-125-percent.png'), Buffer.from(zoomCapture, 'base64'));
      await app.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w?.webContents.setZoomFactor(1);
        w?.setSize(1586, 1000);
      });
    }
    if (baseline) return;
    await expect(page.getByLabel('Modo de layout')).toHaveValue('development');
    const editor = page.locator('.editor-pane');
    const terminals = page.locator('.terminal-host');
    const e = await editor.boundingBox();
    const t = await terminals.first().boundingBox();
    expect(e && t && e.y > t.y).toBeTruthy();
    expect(e && t && e.width > t.width * 1.8).toBeTruthy();
    await page.evaluate(() => {
      (window as unknown as { prismNodes: Element[] }).prismNodes = Array.from(
        document.querySelectorAll('.terminal-host, .cm-editor'),
      );
    });
    const terminalWidthBefore = (await terminals.first().boundingBox())?.width ?? 0;
    const columnDivider = await page
      .getByRole('separator', { name: 'Divisória entre as colunas 1 e 2', exact: true })
      .first()
      .boundingBox();
    if (!columnDivider) throw new Error('Missing terminal divider');
    await page.mouse.move(columnDivider.x + columnDivider.width / 2, columnDivider.y + 20);
    await page.mouse.down();
    await page.mouse.move(columnDivider.x + 45, columnDivider.y + 20, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(async () => (await terminals.first().boundingBox())?.width)
      .not.toBe(terminalWidthBefore);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// unsaved prism');
    await page.keyboard.press('Control+Shift+F11');
    await expect(terminals.first()).toBeHidden();
    await expect(page.getByLabel('não salvo')).toBeVisible();
    await page.screenshot({ path: join(captures, 'after-editor-focus.png') });
    await page.keyboard.press('Control+Shift+F11');
    await expect(terminals.first()).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('// unsaved prism');
    expect(
      await page.evaluate(() =>
        (window as unknown as { prismNodes: Element[] }).prismNodes.every((n) => n.isConnected),
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await expect(terminals.first()).toBeHidden();
    await page.screenshot({ path: join(captures, 'after-home-recent.png') });
    await page.getByRole('button', { name: 'Início', exact: true }).click();
    await expect(terminals.first()).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('// unsaved prism');
    await page.getByRole('tab', { name: 'main.ts' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Dividir à direita' }).click();
    await expect(page.locator('.cm-editor')).toHaveCount(2);
    await page.keyboard.press('Control+Shift+F11');
    await expect(page.locator('.cm-editor').nth(1)).toBeVisible();
    await page.keyboard.press('Control+Shift+F11');
    const separator = page
      .getByRole('separator', { name: 'Divisória entre as linhas 1 e 2', exact: true })
      .last();
    await separator.focus();
    await page.keyboard.press('ArrowDown');
    await page.getByLabel('Modo de layout').selectOption('custom');
    await page.keyboard.press('Control+P');
    await page.getByLabel('Filtrar arquivos').fill('other.ts');
    await page.getByRole('dialog', { name: 'Ir para arquivo' }).getByRole('option').first().click();
    await expect(page.getByLabel('Modo de layout')).toHaveValue('custom');
    await page.getByLabel('Modo de layout').selectOption('development');
    await page.screenshot({ path: join(captures, 'after-split.png') });
    await page.getByRole('tab', { name: 'main.ts' }).first().click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const r = await (window as unknown as { melinna: MelinnaApi }).melinna.layout.get();
          return r.ok ? r.value.panes.filter((p) => p.kind === 'editor').length : 0;
        }),
      )
      .toBe(2);
    await app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
    await expect(page.getByRole('alertdialog', { name: 'Fechar o Melinna' })).toBeVisible();
    await page.screenshot({ path: join(captures, 'after-close-confirmation.png') });
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect
      .poll(() => {
        const state = JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8')) as {
          layout: { panes: { kind: string }[] };
        };
        return state.layout.panes.filter((p) => p.kind === 'editor').length;
      })
      .toBe(2);
    await app.close();
    app = await launchApp(userData);
    await expect(app.page.getByLabel('Modo de layout')).toHaveValue('development');
    await expect(app.page.locator('.terminal-host')).toHaveCount(2);
    await app.page.screenshot({ path: join(captures, 'after-reopen.png') });
    await expect(app.page.locator('.editor-pane')).toHaveCount(2);
    await expect(app.page.locator('.cm-editor:visible')).toHaveCount(2);
    await expect(app.page.locator('.cm-content').first()).toContainText('// unsaved prism');
    writeFileSync(
      join(captures, 'regression.txt'),
      'Electron: parallel PTY, development geometry, focus, stable mounts, unsaved draft, split editor, protected custom layout, divider keyboard, saved file and session reopen passed.\n',
    );
  } finally {
    await app.close();
    cleanup(userData);
    repo.cleanup();
  }
});
