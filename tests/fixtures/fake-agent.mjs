// Agente controlado para testes: comportamento determinístico dirigido pelo que é digitado no PTY.
import { spawn } from 'node:child_process';

const out = (s) => process.stdout.write(s);
const size = () => out(`size=${process.stdout.columns ?? 0}x${process.stdout.rows ?? 0}\r\n`);

let ignoreSigint = false;
/** Ctrl+C seguidos (até 1 s entre eles) para sair: 2 imita o Claude Code. */
let ctrlCToExit = 1;
let ctrlCCount = 0;
let lastCtrlC = 0;

function onCtrlC() {
  if (ignoreSigint) return;
  const now = Date.now();
  ctrlCCount = now - lastCtrlC <= 1000 ? ctrlCCount + 1 : 1;
  lastCtrlC = now;
  if (ctrlCCount >= ctrlCToExit) process.exit(130);
  out('press-ctrl-c-again\r\n');
}
let pendingCpr = null;
let line = '';

out(`${JSON.stringify(process.argv.slice(2))}\r\n`);
size();
out('\x1b[32mpronto\x1b[0m\r\n');

process.stdout.on('resize', size);
process.on('SIGINT', onCtrlC);
process.on('SIGTERM', () => {
  if (!ignoreSigint) process.exit(143);
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on('data', (buf) => {
  let text = buf.toString('utf8');
  if (pendingCpr) {
    const m = /\x1b\[(\d+);(\d+)R/.exec(text);
    if (m) {
      const resolve = pendingCpr;
      pendingCpr = null;
      resolve(`${m[1]};${m[2]}`);
      text = text.replace(m[0], '');
    }
  }
  for (const ch of text) {
    if (ch === '\x03') {
      onCtrlC();
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      const cmd = line;
      line = '';
      if (cmd.length > 0) void handle(cmd);
      continue;
    }
    line += ch;
  }
});

function waitCpr(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCpr = null;
      resolve('timeout');
    }, ms);
    pendingCpr = (v) => {
      clearTimeout(timer);
      resolve(v);
    };
  });
}

async function handle(cmd) {
  const [word, ...rest] = cmd.split(' ');
  const arg = rest.join(' ');
  switch (word) {
    case '/model':
      out(`model=${arg}\r\n`);
      return;
    case '/permission':
      out(`permission=${arg}\r\n`);
      return;
    case '/cwd':
      out(`cwd=${process.cwd()}\r\n`);
      return;
    case '/busy': {
      const until = Date.now() + Number(arg);
      const timer = setInterval(() => {
        out('.');
        if (Date.now() >= until) {
          clearInterval(timer);
          out('\r\nbusy-done\r\n');
        }
      }, 100);
      return;
    }
    case 'query-cursor': {
      const wait = waitCpr(5000);
      out('\x1b[6n');
      out(`cpr=${await wait}\r\n`);
      return;
    }
    case 'flood': {
      const total = Number(arg) * 1024 * 1024;
      let sent = 0;
      let n = 0;
      const pump = () => {
        while (sent < total) {
          const chunk = `${String(n++).padStart(10, '0')} ${'x'.repeat(52)}\r\n`;
          sent += chunk.length;
          if (!process.stdout.write(chunk)) {
            process.stdout.once('drain', pump);
            return;
          }
        }
        out('flood-done\r\n');
      };
      pump();
      return;
    }
    case 'spawn-child': {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      out(`child=${child.pid}\r\n`);
      return;
    }
    case 'double-ctrl-c':
      ctrlCToExit = 2;
      out('double-ctrl-c\r\n');
      return;
    case 'ignore-sigint':
      ignoreSigint = true;
      out('ignoring-sigint\r\n');
      return;
    case 'exit':
      process.exit(Number(arg));
      return;
    default:
      out(`echo:${cmd}\r\n`);
  }
}
