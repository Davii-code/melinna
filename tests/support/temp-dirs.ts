import { chmodSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Limpa o atributo read-only de tudo dentro de `dir`.
 *
 * O `fs.rmSync` do Node embutido no Electron falha com `EPERM` ao remover um arquivo read-only no
 * Windows (o Node do sistema resolve isso por dentro; o do Electron não). Como os testes de
 * integração rodam com `ELECTRON_RUN_AS_NODE`, a limpeza de diretório temporário precisa fazer isso
 * explicitamente, senão a suíte falha mesmo com as asserções verdes.
 */
function clearReadOnly(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      clearReadOnly(abs);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      chmodSync(abs, 0o666);
    } catch {
      // arquivo em uso: o `rmSync` abaixo tenta de novo e reporta o erro real
    }
  }
}

/** Remove um diretório temporário de teste, sobrevivendo a arquivos read-only e a handles do Windows. */
export function removeDirRecursive(dir: string): void {
  try {
    clearReadOnly(dir);
  } catch {
    // diretório já removido ou inacessível: `rmSync` decide o resultado
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
