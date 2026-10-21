// Gera os ícones do executável a partir dos assets da marca (docs/brand/avatar.jpg e o prisma do logo),
// sem dependência nova: monta um SVG, abre numa janela oculta do Electron e captura a página.
// Composição: campo quadrado com cantos chanfrados, o avatar no disco central e o prisma como selo.
// Uso: `npm run icons`.
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

const FIELD = 'M 36 0 H 476 L 512 36 V 476 L 476 512 H 36 L 0 476 V 36 Z';
const BANDS = ['#ff3b30', '#ff9f0a', '#ffd60a', '#34c759', '#0a84ff', '#bf5af2'];

/** Selo do prisma no canto inferior direito: feixe branco entra, seis faixas saem. */
function prismBadge() {
  const rays = BANDS.map((color, i) => {
    const x2 = 380 - i * 4;
    const y2 = 258 + i * 17;
    return `<line x1="270" y1="246" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="12"/>`;
  }).join('');
  return `
  <g transform="translate(372 372) scale(0.42) translate(-250 -250)">
    <circle cx="250" cy="250" r="150" fill="#07080b" stroke="#262c36" stroke-width="6"/>
    <g stroke-linecap="round">${rays}</g>
    <line x1="120" y1="246" x2="225" y2="246" stroke="#e6e9ef" stroke-width="12" stroke-linecap="round"/>
    <path d="M 245 170 L 312 290 L 178 290 Z" fill="#12151b" stroke="#e6e9ef" stroke-width="8" stroke-linejoin="round"/>
  </g>`;
}

function iconSvg(avatarBase64) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><clipPath id="disc"><circle cx="256" cy="256" r="236"/></clipPath></defs>
  <path d="${FIELD}" fill="#07080b"/>
  <image href="data:image/jpeg;base64,${avatarBase64}" x="0" y="0" width="512" height="512"
         clip-path="url(#disc)" preserveAspectRatio="xMidYMid slice"/>
  <circle cx="256" cy="256" r="236" fill="none" stroke="#262c36" stroke-width="4"/>
  ${prismBadge()}
</svg>`;
}

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
  await win.webContents.executeJavaScript(
    'document.images[0].decode().then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))',
  );
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();
  if (image.isEmpty()) throw new Error(`captura vazia em ${size}px`);
  return image.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  try {
    const avatar = (await readFile(join(root, 'docs', 'brand', 'avatar.jpg'))).toString('base64');
    await mkdir(outDir, { recursive: true });
    // Uma captura só: a segunda janela pode não pintar em algumas máquinas; o 256 sai do 512 redimensionado.
    const image = await render(iconSvg(avatar), 512);
    await writeFile(join(outDir, 'icon.png'), image.toPNG());
    await writeFile(join(outDir, 'icon-256.png'), image.resize({ width: 256, height: 256, quality: 'best' }).toPNG());
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
