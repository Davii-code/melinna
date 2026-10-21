// Gera os ícones do executável a partir de docs/brand/logo.svg, sem dependência nova:
// abre o SVG numa janela oculta do Electron e captura a página. Uso: `npm run icons`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build', 'icons');

// A captura por GPU falha em algumas máquinas (UnknownVizError); a renderização por software é suficiente aqui.
app.disableHardwareAcceleration();
// Sem este handler o Electron encerra o app ao destruir a janela de captura, antes de gravar os arquivos.
app.on('window-all-closed', () => undefined);

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block"></body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  await win.webContents.executeJavaScript('document.images[0].decode().then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))');
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  if (image.isEmpty()) throw new Error(`captura vazia em ${size}px`);
  return image.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  try {
    const svg = await readFile(join(root, 'docs', 'brand', 'logo.svg'), 'utf8');
    await mkdir(outDir, { recursive: true });
    // Uma captura só: a segunda janela pode não pintar em algumas máquinas; o 256 sai do 512 redimensionado.
    const image = await render(svg, 512);
    await writeFile(join(outDir, 'icon.png'), image.toPNG());
    await writeFile(join(outDir, 'icon-256.png'), image.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
