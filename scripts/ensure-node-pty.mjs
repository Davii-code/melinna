// node-pty 1.1 é um módulo N-API: o mesmo binário serve ao Node do sistema e ao do Electron.
// Windows e macOS usam os prebuilds do pacote; nas demais plataformas compila com node-gyp.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ptyDir = dirname(require.resolve('node-pty/package.json'));
const prebuild = join(ptyDir, 'prebuilds', `${process.platform}-${process.arch}`);
const built = join(ptyDir, 'build', 'Release', 'pty.node');

if (existsSync(prebuild) || existsSync(built)) {
  process.exit(0);
}

// Durante `npm install`, o npm informa o node-gyp que ele mesmo traz.
const nodeGyp =
  process.env.npm_config_node_gyp ?? join(dirname(require.resolve('node-gyp/package.json')), 'bin', 'node-gyp.js');
const child = spawn(process.execPath, [nodeGyp, 'rebuild'], { cwd: ptyDir, stdio: 'inherit', shell: false });
child.on('exit', (code) => process.exit(code ?? 1));
