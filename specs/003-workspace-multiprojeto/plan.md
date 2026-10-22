# Implementation Plan: Workspace multiprojeto

**Branch**: `003-workspace-multiprojeto` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-workspace-multiprojeto/spec.md`

## Summary

O workspace (`Group`) passa de uma pasta (`repoPath`) para uma lista ordenada de pastas com uma
principal. Sessões novas rodam com a principal como cwd e, para agentes que declaram a capacidade
`extraDirs` no catálogo, recebem as demais como argumentos (`--add-dir <pasta>` repetido no Claude
Code). O estado migra de v2 para v3 lendo cada `repoPath` como lista de uma pasta. A interface ganha
"Novo workspace" e "Editar workspace"; o explorador e a decoração de git mostram uma raiz por pasta.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito (`exactOptionalPropertyTypes`), Node 24, Electron 44.9.2

**Primary Dependencies**: React 19.3.1, node-pty 1.1, @xterm/xterm 6, CodeMirror 6 — **nenhuma nova**

**Storage**: `state.json` em userData via `StateStore`; esquema sobe de 2 para 3

**Testing**: Vitest 5 (`unit`, `unit:renderer`, `integration` sob o Node do Electron, `arch`),
Playwright 1.64 (e2e)

**Target Platform**: Windows 10 1809+ (validado), Linux x64 (AppImage/tar.gz)

**Project Type**: app desktop (Electron) com núcleo puro em `src/core`

**Performance Goals**: raízes de um workspace com 10 pastas na aba Arquivos em < 2 s (SC-005);
lançamento sem custo perceptível adicional

**Constraints**: sem shell no lançamento (Princípio VIII); limite de linha de comando do Windows
(`WINDOWS_CMDLINE_LIMIT` em `launch-plan.ts`); núcleo sem Electron (Princípio IV)

**Scale/Scope**: até 32 pastas por workspace (FR-019); alvo de desempenho medido com 10; dezenas de workspaces

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Situação |
|---|---|
| I. Agente é processo | ✅ A capacidade de pastas extras é declarada no catálogo (`extraDirs`), genérica; nenhum caso especial por nome de agente. |
| II. Pasta do usuário com controle explícito (2.0.0) | ✅ Nada é escrito nas pastas; remover pasta/workspace só tira o registro. cwd = pasta principal. |
| III. PTY é a fonte da verdade | ✅ Sessões vivas não são relançadas; mudança vale para sessões novas. |
| IV. Núcleo independente | ✅ Modelo, migração, validação e montagem de argumentos em `src/core`; IPC em `src/main`; UI em `src/renderer` só via `src/shared`. |
| V. Testes para todo comportamento | ✅ Estratégia abaixo; cada task de código inclui seus testes. |
| VI. Entregável completo | ✅ Sem TODO; casos de borda da spec viram requisitos e testes. |
| VII. Sem surpresas | ✅ Nenhuma dependência nova. Muda três contratos, aprovados pelo dono em 2026-10-22: formato do estado (v2→v3), esquema do catálogo (`extraDirs`) e canais IPC — ver "Aprovações". |
| VIII. Execução segura | ✅ Caminhos viram argumentos separados do `spawn` sem shell; validados como absolutos e existentes; limite de linha de comando checado antes do spawn. |
| IX/X. Marca e código próprios | ✅ Sem referência externa. |

Resultado: **passa** (aprovações do Princípio VII registradas abaixo).

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| Estado em disco | `STATE_SCHEMA_VERSION` 2 → 3; `Group.folders`, `primaryFolderId`, `Task.extraDirs`, `Execution.notices`; backup `state.v2.json.bak` | aprovado pelo dono em 2026-10-22 |
| Catálogo de agentes | campo opcional `extraDirs` | aprovado pelo dono em 2026-10-22 |
| IPC | `workspace.createWorkspace`, `updateWorkspace`, `pickFolders`; `Group` e `WorkspaceSnapshot` com campos novos | aprovado pelo dono em 2026-10-22 |

## Design

### Núcleo (`src/core`)

- **`persistence/state-schema.ts`**: `Group` ganha `folders?: WorkspaceFolder[]` (`{ path, id }`) e
  `primaryFolderId?`; `repoPath`/`repoId` passam a ser derivados da principal e mantidos para
  compatibilidade de leitura (sessões e raízes antigas usam `task.repoPath`). `STATE_SCHEMA_VERSION`
  = 3. `parseState` migra v2 → v3 (ver data-model.md). Grupo sem pasta (grupos manuais antigos)
  continua válido.
- **`workspace/workspace-folders.ts`** (novo, puro): `normalizeFolders`, `addFolder`, `removeFolder`,
  `setPrimary`, `primaryOf`, `extrasOf`, com as regras FR-001..FR-006 e FR-017.
- **`workspace/workspace-service.ts`**: `createWorkspace(name, paths[], primaryIndex?)`,
  `updateWorkspace(id, patch)` (renomear, adicionar, remover, trocar principal), verificação de
  existência por `fs.stat`; `openWorkspace` mantém o comportamento atual (uma pasta, raiz do repo).
  Pastas adicionadas pela edição **não** sobem para a raiz do repositório (edge case da spec).
- **`catalog/schema.ts` + `catalog-service`**: `AgentDefinition.extraDirs?:
  { style: 'repeat'; args: string[] } | { style: 'join'; separator: string; args: string[] }`, com
  `{dir}` / `{dirs}` como marcador. Validação do catálogo recusa formas inválidas.
- **`catalog/launch-plan.ts`**: `buildLaunch` recebe `extraDirs: string[]` e só monta os
  argumentos depois de resolver o alvo real (o executável, ou `node` + script quando o agente é um
  shim `.cmd`/`.ps1` do npm no Windows), como já faz com o enunciado; cada pasta é um item de
  `args`, nunca texto de shell (Princípio VIII). No estilo `join`, pasta cujo caminho contém o
  separador é omitida e vira `extra-dirs-omitted`. Soma ao cálculo do limite de linha de comando:
  `WINDOWS_CMDLINE_LIMIT` no Windows; no Linux, 128 KiB (margem conservadora abaixo do ARG_MAX
  típico de 2 MiB). Excedeu → `INPUT_INVALID` (FR-016). Retorna `extraDirsApplied`.
- **`execution/prepare.ts` / `start.ts`**: a tarefa direta guarda `extraDirs` resolvidas no momento
  da criação (snapshot), para relançar igual; principal indisponível → erro; extra indisponível →
  omitida e registrada em `execution.notices` (FR-015).
- **`files/roots.ts`**: `navigationRoots` emite uma raiz por pasta do workspace, principal primeiro,
  com `primary: true` e `available`. Essas raízes são o conjunto de "raízes registradas" do editor e
  do git: o guard de escrita do editor (Princípio II) aceita qualquer pasta do workspace, recusa pasta
  indisponível e nunca escreve em `.git/`.
- **`persistence/state-store.ts`**: antes da primeira gravação v3 sobre um arquivo v2, copia
  `state.json` para `state.v2.json.bak` (uma vez). Um app antigo que abra o v3 entra no modo
  somente-leitura que já existe para versão maior.
- **Concorrência**: `updateWorkspace` passa pelo `KeyedMutex` com a chave do workspace; o lançamento
  lê as pastas uma vez, no início (snapshot).

### Main/IPC (`src/main/ipc`)

Canais novos em `workspace`: `createWorkspace`, `updateWorkspace`, `pickFolders` (diálogo com seleção
múltipla). `Group` no snapshot passa a ter `folders` e `primaryFolderId`. Ver
[contracts/ipc.md](contracts/ipc.md). Validação em `validate-workspace.ts` (ids, nomes, listas de
caminhos com limite de tamanho por item e de quantidade).

### Renderer

- `components/WorkspaceDialog.tsx` (novo): criar e editar (nome, lista de pastas com "principal"
  por botão de rádio, adicionar pelo diálogo nativo, remover), com o aviso "vale para terminais
  novos" quando o workspace tem sessão viva.
- `Tree/TreeGroup.tsx`: botão "Editar workspace"; tooltip com as pastas; `TreeExecution` mostra o
  selo "só a principal" quando a execução tem o aviso.
- Barra lateral: "+" ganha "Novo workspace" ao lado de "Abrir pasta".
- `Files/FileExplorer.tsx`: raízes com marca de principal e estado indisponível.

### Erros e logs

- Erros: `INPUT_INVALID` com `userMessage` específica (nome inválido, pasta duplicada, última pasta,
  pasta inexistente, pastas demais para a linha de comando). Nenhum código novo.
- Logs: `workspace.created`, `workspace.updated` (`{ groupId, folders: n, change }`),
  `workspace.removed` (`{ groupId, folders: n }`), `execution.extra_dirs`
  (`{ execId, applied, omitted: n }`). Caminhos não vão para o log (FR-018), só contagens e ids.
- Diálogo de edição: cada mudança é aplicada na hora (uma chamada `updateWorkspace` por ação), então
  não há transação parcial; uma falha mostra a mensagem e deixa o workspace no último estado salvo.

### Segurança

- Caminhos recebidos por IPC: string, até `LIMITS.path`, até 32 pastas; normalizados com
  `path.resolve` e checados com `fs.stat` (diretório) no núcleo.
- Spawn sem shell; cada pasta é um item de `args`.
- Nenhuma escrita nas pastas (Princípio II).

## Estratégia de testes

| Camada | O que cobre | Onde |
|---|---|---|
| Unit core | regras de pastas (FR-001..006, 017), migração v2→v3 e leitura de v3, `buildLaunch` com `repeat`/`join`, limite de linha de comando, catálogo inválido | `tests/unit/core/workspace/`, `tests/unit/core/persistence/`, `tests/unit/core/catalog/` |
| Unit main | canais novos, validação de entrada, `pickFolders` | `tests/unit/main/ipc/register-workspace.test.ts` |
| Unit renderer | `WorkspaceDialog` (criar, editar, validações, aviso de sessão viva), selo "só a principal", raízes no explorador | `tests/unit/renderer/` |
| Integração | lançamento real com PTY: cwd = principal e argumentos `--add-dir` para cada extra; extra indisponível omitida; shell sem extras | `tests/integration/core/execution/multi-folder.test.ts` (agente falso imprime `argv` e `cwd`) |
| Arch | fronteiras continuam valendo | `tests/arch` (sem mudança) |
| e2e | criar workspace com duas pastas, abrir terminal e ver os argumentos no eco do agente falso | `tests/e2e/multi-folder.spec.ts` |

Roteiro para o `/testar-tela` em [quickstart.md](quickstart.md).

## Project Structure

### Documentation (this feature)

```text
specs/003-workspace-multiprojeto/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ipc.md
└── tasks.md            (gerado por /speckit-tasks)
```

### Source Code (repository root)

```text
src/core/persistence/state-schema.ts      (Group.folders, migração v3)
src/core/workspace/workspace-folders.ts   (novo, regras puras)
src/core/workspace/workspace-service.ts   (createWorkspace, updateWorkspace)
src/core/catalog/schema.ts                (extraDirs)
src/core/catalog/launch-plan.ts           (montagem e limite)
src/core/execution/prepare.ts, start.ts   (pastas extras e avisos)
src/core/files/roots.ts                   (raiz por pasta)
src/shared/ipc-contract.ts                (canais e tipos)
src/main/ipc/register-workspace.ts, validate-workspace.ts
src/main/main.ts                          (pickFolders com multiSelections)
src/preload/preload.ts                    (sem mudança estrutural: group(CHANNELS.workspace))
src/renderer/components/WorkspaceDialog.tsx (novo)
src/renderer/components/Tree/TreeGroup.tsx, TreeExecution.tsx
src/renderer/components/Files/FileExplorer.tsx
src/renderer/App.tsx
catalog/agents.json                       (extraDirs do Claude Code; Codex/Gemini após conferência)
tests/... (ver estratégia)
```

**Structure Decision**: mantém a estrutura atual de camadas; um módulo puro novo no núcleo para as
regras de pastas e um componente novo no renderer.

## Complexity Tracking

Sem violações da constitution.
