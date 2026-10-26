# Contrato de IPC: 009 (mudança de contrato — exige aprovação, constitution VII)

Tipos em `src/core/run/types.ts` e `src/core/files/search.ts`; assinaturas em
`src/shared/ipc-contract.ts`; handlers em `src/main/ipc/register-run.ts` e `register-files.ts` /
`register-git.ts`. Todo canal devolve `Result<T>` com mensagem pt-BR, como os demais.

## Alterados

| Canal | Antes (007) | Depois (009) |
|---|---|---|
| `run:list` | `(groupId?) → RunCommand[]` (detectados + personalizados) | `(groupId?) → { configs: RunConfigView[]; detected: RunCommand[] }` |
| `run:start` | `(groupId, commandId, size, choice?)` | `(groupId, configId, size, choice?)` → `RunStarted \| RunNeedsConfirm`; executa "antes de lançar"; com `allowParallel` cria nova execução |
| `run:rerun` | `(execId, size)` | igual; relança a mesma configuração com o ambiente atual dela |

## Novos / substituídos

| Canal | Assinatura | Substitui |
|---|---|---|
| `run:saveConfig` | `(groupId, input: RunConfigInput) → RunConfigView` | `run:saveCommand` |
| `run:removeConfig` | `(groupId, configId) → void` (erro `RUN_CONFIG_RUNNING` se viva) | `run:removeCommand` |
| `run:reorder` | `(groupId, items: { id: string; folderGroup: string \| null; order: number }[]) → void` | — |
| `files:searchProject` | `(query: ProjectSearchQuery) → ProjectSearchResult`; cancela a busca anterior da janela | — |
| `git:fileAtHead` | `(repo, path) → { text: string } \| { missing: true }` (somente leitura, `--no-optional-locks`) | — |

`RunConfigInput` = `RunConfig` sem `order` (o núcleo calcula), com `id?`, e com `program` usado só na
ferramenta `program` (nas outras o núcleo deriva e ignora o valor recebido).
`ProjectSearchQuery.roots` é validado no principal contra as raízes registradas do workspace.
`ProjectSearchQuery` = `{ roots: string[]; text: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean; include?: string; exclude?: string }`.

## Erros novos

`RUN_CONFIG_INVALID` (campo e motivo em `details`), `RUN_CONFIG_CYCLE` (cadeia em `details`),
`RUN_CONFIG_RUNNING`, `RUN_CONFIG_MISSING` (rerun de configuração removida), `RUN_BEFORE_LAUNCH_FAILED`
(nome e código de saída, ou `cancelled`/`already-running`), `RUN_UNSAFE_TARGET`, `SEARCH_REGEX_INVALID`,
`SEARCH_CANCELLED`, `SEARCH_TIMEOUT`.

## Eventos

Nenhum evento novo: "antes de lançar" usa as mudanças de estado de execução que o renderer já recebe.

## Logs

`run.start { configId, tool, envNames, parallel, beforeLaunch }` — nunca valores de `env` nem
`runtimeOptions`. `files.search { roots: n, files, hits, truncated, durationMs }` — nunca o texto buscado.
