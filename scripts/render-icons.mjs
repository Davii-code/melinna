// Gera os ícones do executável a partir de docs/brand/logo.svg, sem dependência nova:
// abre o SVG numa janela oculta do Electron e captura a página. Uso: `npm run icons`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'icons');

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  return image.resize({ width: size, height: size }).toPNG();
}

app.whenReady().then(async () => {
  try {
    const svg = await readFile(join(root, 'docs', 'brand', 'logo.svg'), 'utf8');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'icon.png'), await render(svg, 512));
    await writeFile(join(outDir, 'icon-256.png'), await render(svg, 256));
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
