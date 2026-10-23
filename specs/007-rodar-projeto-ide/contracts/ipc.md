# Contrato IPC: Configurações de execução e mapas de atalhos

Grupos `run` e `prefs`; todos devolvem `Result<T>`. O grupo `ide` do plano anterior foi removido.

```ts
type RunTool = 'npm' | 'pnpm' | 'yarn' | 'maven' | 'gradle' | 'compose' | 'custom';
interface RunCommand {
  id: string; groupId: string; source: 'npm' | 'maven' | 'gradle' | 'compose' | 'custom'; tool: RunTool;
  label: string; program: string; args: string[]; folder: string;
  available: boolean; unavailableReason: 'not-found' | 'folder-outside' | null; searched: string;
}
interface RunCatalog { commands: RunCommand[]; warnings: { groupId: string; folder: string; message: string }[] }
type KeymapId = 'windows' | 'intellij' | 'eclipse' | 'vscode';
interface Preferences { keymap: KeymapId; activeRun: { groupId: string; commandId: string } | null; readOnly: boolean }

run: {
  /** Configurações de todos os workspaces abertos (personalizadas e detectadas). */
  list(): Promise<Result<RunCatalog>>;
  /** O main resolve commandId; viva → reused=true; encerrada → relança no mesmo painel. */
  start(groupId: string, commandId: string, size: TermSize, choice?: 'wrapper-sh' | 'system-tool'):
    Promise<Result<{ taskId: string; execId: string; reused: boolean } | { needsConfirm: 'wrapper-sh'; wrapper: string }>>;
  rerun(execId: string, size: TermSize): Promise<Result<void>>;
  saveCommand(groupId: string, input: { id?: string; label: string; program: string; args: string[]; folder: string }): Promise<Result<RunCommand>>;
  removeCommand(groupId: string, commandId: string): Promise<Result<void>>;
}

prefs: {
  get(): Promise<Result<Preferences>>;
  setKeymap(keymap: KeymapId): Promise<Result<void>>;
  setActiveRun(ref: { groupId: string; commandId: string } | null): Promise<Result<void>>;
}
```

Parar usa o canal existente `executions.stop`. Duplicar é `saveCommand` sem `id` com os campos copiados e o nome
sugerido "<nome> (cópia)" (com número se já existir). `rerun` resolve a configuração de novo
(`COMMAND_STALE`/`PROGRAM_NOT_FOUND` como no `start`).

## Validação (main)

| Campo | Regra |
|---|---|
| `groupId`, `execId` | existentes; `execId` de `rerun` precisa ter `command` |
| `commandId` | formato de id; existência resolvida no serviço (`COMMAND_STALE`) |
| `choice` | ausente, `wrapper-sh` ou `system-tool`; no serviço, só aceito quando a configuração usa o wrapper do projeto sem bit de execução (senão `INPUT_INVALID`) |
| `label` | 1–80, sem quebra de linha; único entre as personalizadas do workspace |
| `program` | 1–`LIMITS.path`, sem caracteres de controle |
| `args` | 0–64 itens, cada um 0–4.096, sem caracteres de controle |
| `folder` | uma das pastas do workspace `groupId` (comparação normalizada) |
| `keymap` | um dos 4 ids |
| `ref` de `setActiveRun` | `null` ou ids com formato válido e `groupId` existente |

## Erros

| Situação | Código / mensagem |
|---|---|
| programa não encontrado | `PROGRAM_NOT_FOUND` "Programa não encontrado: X." |
| configuração não existe mais | `COMMAND_STALE` "A configuração mudou; abra o seletor de novo." |
| lote (`.cmd`/`.bat`) que não é shim do npm | `INPUT_INVALID` "Este programa só roda pelo prompt de comando; use o executável." |
| nome repetido | `INPUT_INVALID` "Já existe uma configuração com esse nome." |
| pasta fora do workspace | `INPUT_INVALID` "A pasta precisa ser do workspace." |
| sem vaga | `LIMIT_REACHED` |
| excluir configuração / remover workspace com comando rodando | `EXECUTION_RUNNING` "Pare o comando antes." |
| preferências de versão mais nova | `setKeymap`/`setActiveRun` valem na sessão; `get` devolve `readOnly: true` |

## Logs

`run.started { groupId, source, tool, reused }`, `run.stopped { groupId, exitCode }`,
`run.command_saved { groupId, created }`, `run.command_removed { groupId }`,
`prefs.keymap_changed { keymap }` — sem argumentos, programas nem caminhos.
