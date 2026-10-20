// Roda o Vitest com o Node embutido no Electron, para que os testes de integração
// carreguem o node-pty no mesmo runtime do hospedeiro.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');
const vitestCli = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const child = spawn(electronBinary, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
