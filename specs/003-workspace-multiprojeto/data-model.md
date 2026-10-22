# Data Model: Workspace multiprojeto

## Group (workspace) — esquema v3

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | inalterado |
| `name` | string | 1–80 caracteres, sem quebra de linha (FR-017) |
| `order` | number | inalterado |
| `folders` | `WorkspaceFolder[]` | ≥ 1 quando o grupo é workspace; sem caminho repetido (comparação sem diferenciar maiúsculas no Windows); máximo 32 |
| `primaryFolderId` | string | id de uma pasta de `folders`; obrigatório quando há pastas |
| `repoPath` | string? | **derivado**: caminho da principal (compatibilidade) |
| `repoId` | string? | **derivado**: id do caminho da principal |
| `colorIndex`, `lastOpenedAt` | inalterados | |

Grupo sem `folders` = grupo manual antigo, sem pasta (continua válido).

## WorkspaceFolder

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | gerado (`newId`) |
| `path` | string | absoluto, normalizado com `path.resolve`; deve ser diretório no momento de adicionar |

Disponibilidade (`available`) não é persistida: é calculada na leitura (`fs.stat`).

## Task (sessão)

| Campo novo | Tipo | Regra |
|---|---|---|
| `extraDirs` | `string[]?` | snapshot das pastas extras no momento da criação; ausente = nenhuma; no relançamento, pasta indisponível é omitida com aviso |

`repoPath` da tarefa = pasta principal no momento da criação (cwd).

## Execution

| Campo novo | Tipo | Regra |
|---|---|---|
| `notices` | `ExecutionNotice[]?` | avisos do lançamento: `{ kind: 'extra-dirs-unsupported' }` ou `{ kind: 'extra-dirs-omitted', count }` |

## AgentDefinition (catálogo)

| Campo novo | Tipo | Regra |
|---|---|---|
| `extraDirs` | `{ style: 'repeat', args: string[] } \| { style: 'join', separator: string, args: string[] }` | `repeat`: `args` contém `{dir}` exatamente uma vez; `join`: `args` contém `{dirs}` uma vez e `separator` não vazio; pasta cujo caminho contém o separador é omitida |

## Transições

- Adicionar pasta: valida diretório e duplicata → acrescenta ao fim.
- Remover pasta: recusa se for a única; se era a principal, a próxima (ou a anterior, se era a última)
  vira principal.
- Trocar principal: id precisa existir em `folders`.

## Migração v2 → v3 (leitura)

- `schemaVersion` < 3 e `group.repoPath` presente → `folders = [{ id: novo, path: repoPath }]`,
  `primaryFolderId` = esse id.
- `schemaVersion` < 3 e sem `repoPath` → sem `folders`.
- Tarefas e execuções v2 não ganham `extraDirs`/`notices` (ausentes = nenhum).
- Antes da primeira gravação v3 sobre um arquivo v2, `state.json` é copiado para `state.v2.json.bak`
  (uma vez). A primeira gravação após a leitura grava v3.
- App antigo abrindo um v3: `StateStore` já abre versão maior em somente-leitura (sem sobrescrever).
