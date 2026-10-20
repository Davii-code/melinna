import { startHost } from './start';

/** Processo hospedeiro de PTY: iniciado pelo principal com ELECTRON_RUN_AS_NODE=1, destacado. */
const userData = process.env.MELINNA_USER_DATA;
if (!userData) {
  process.stderr.write('MELINNA_USER_DATA ausente\n');
  process.exit(2);
}
process.on('uncaughtException', (err) => process.stderr.write(`${String(err)}\n`));
startHost({ userData, onExit: (code) => process.exit(code) }).catch((err: unknown) => {
  process.stderr.write(`falha ao iniciar o hospedeiro: ${String(err)}\n`);
  process.exit(1);
});
