/** Worker isolado: SQL nunca bloqueia o processo principal e pode ser interrompido. */
export const SQLITE_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync, constants: C } = require('node:sqlite');
let db;
try {
  db = new DatabaseSync(workerData.path, { readOnly: true, allowExtension: false });
  db.enableDefensive(true);
  db.setAuthorizer((action, arg1, arg2) => {
    if (action === C.SQLITE_ATTACH || action === C.SQLITE_DETACH || action === C.SQLITE_PRAGMA) return C.SQLITE_DENY;
    if (action === C.SQLITE_FUNCTION && ['load_extension', 'readfile', 'writefile', 'eval'].includes(String(arg2 || arg1).toLowerCase())) return C.SQLITE_DENY;
    return [C.SQLITE_SELECT, C.SQLITE_READ, C.SQLITE_FUNCTION, C.SQLITE_RECURSIVE].includes(action) ? C.SQLITE_OK : C.SQLITE_DENY;
  });
  parentPort.postMessage({ ready: true });
} catch { parentPort.postMessage({ error: 'Não foi possível abrir o banco SQLite somente leitura.' }); }
parentPort.on('message', ({ id, sql }) => {
  try {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    const columns = statement.columns().map(column => column.name);
    const rows = [];
    let bytes = 0;
    let truncated = false;
    for (const row of statement.iterate()) {
      const values = columns.map(column => {
        const value = row[column];
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Uint8Array) return '[binary ' + value.byteLength + ' bytes]';
        return value;
      });
      bytes += Buffer.byteLength(JSON.stringify(values));
      if (rows.length >= 500 || bytes > 2 * 1024 * 1024) { truncated = true; break; }
      rows.push(values);
    }
    parentPort.postMessage({ id, result: { columns, rows, truncated } });
  } catch { parentPort.postMessage({ id, error: 'Consulta recusada ou SQL inválido. Este banco é somente leitura.' }); }
});
`;
