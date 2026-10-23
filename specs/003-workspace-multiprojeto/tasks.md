# Tasks: Workspace multiprojeto

**Input**: `specs/003-workspace-multiprojeto/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação. Testes são escritos nas tasks;
rodar testes, testar a tela e revisar ficam com o dono do projeto (`/testar`, `/testar-tela`, `/revisar`).

**Marcadores**: `[P]` paralelizável (arquivos diferentes, sem dependência pendente); `[simples]` task
mecânica e localizada, delegável ao implementer.

## Phase 1: Setup

- [X] T001 Conferir na `--help` das versões instaladas do Claude Code, do Codex CLI e do Gemini CLI como cada um recebe pastas extras (nome da opção; repetida ou lista com separador) e registrar o resultado, com a versão conferida, em `specs/003-workspace-multiprojeto/research.md` (seção R1); sem confirmação, o agente fica sem `extraDirs`

## Phase 2: Foundational (bloqueia todas as histórias)

**Tests**

- [X] T002 [P] Escrever testes da migração em `tests/unit/core/persistence/state-schema.test.ts`: estado v2 com `repoPath` vira `folders=[{id, path: repoPath}]` e `primaryFolderId` = esse id; grupo v2 sem `repoPath` continua sem `folders`; estado v3 é lido sem mudança; `repoPath`/`repoId` derivados da principal; tarefas e execuções v2 sem `extraDirs`/`notices`; antes da primeira gravação v3 sobre um v2 o `StateStore` grava `state.v2.json.bak` uma vez (teste em `tests/unit/core/persistence/state-store.test.ts`)
- [X] T003 [P] Escrever testes das regras puras em `tests/unit/core/workspace/workspace-folders.test.ts`: adicionar acrescenta ao fim; recusa duplicata (sem diferenciar maiúsculas no Windows); recusa mais de 32 pastas; remover a única pasta é recusado ("Um workspace precisa de ao menos uma pasta."); remover a principal promove a próxima (ou a anterior, se era a última); `setPrimary` com id inexistente é recusado; `primaryOf`/`extrasOf`

**Implementação**

- [X] T004 Em `src/core/persistence/state-schema.ts`: tipos `WorkspaceFolder { id, path }`, `Group.folders?`, `Group.primaryFolderId?`, `Task.extraDirs?: string[]`, `Execution.notices?: ExecutionNotice[]` (`{ kind: 'extra-dirs-unsupported' } | { kind: 'extra-dirs-omitted'; count: number }`); `STATE_SCHEMA_VERSION = 3`; migração v2→v3 em `parseState` conforme data-model.md e backup `state.v2.json.bak` em `src/core/persistence/state-store.ts` (faz T002 passar)
- [X] T005 Criar `src/core/workspace/workspace-folders.ts` com `normalizeFolders`, `addFolder`, `removeFolder`, `setPrimary`, `primaryOf`, `extrasOf` e a derivação de `repoPath`/`repoId` a partir da principal; erros `MelinnaError('INPUT_INVALID')` com as mensagens de `contracts/ipc.md` (faz T003 passar)
- [X] T006 [simples] (depende de T004) Exportar `WorkspaceFolder` e `ExecutionNotice` em `src/shared/ipc-contract.ts` (tipos re-exportados de `state-schema`) e acrescentar `folderAvailability: Record<string, boolean>` a `WorkspaceSnapshot` em `src/core/api-types.ts`

**Checkpoint**: estado v3 lido e gravado; regras de pastas cobertas por testes.

---

## Phase 3: User Story 1 — Criar um workspace com vários projetos (P1) 🎯 MVP

**Goal**: criar workspace com nome e várias pastas e abrir sessões que rodam na principal recebendo as extras.

**Independent Test**: criar um workspace com duas pastas e abrir o agente falso; ele imprime cwd = principal e um `--add-dir <pasta>` por extra.

### Tests (escritos antes)

- [X] T007 [P] [US1] Testes de `createWorkspace` em `tests/unit/core/workspace/create-workspace.test.ts`: nome 1–80 sem quebra de linha; ≥ 1 pasta; pasta inexistente recusada ("A pasta X não existe."); `primaryIndex` padrão 0 e fora do intervalo recusado; pasta dentro de repositório guardada como escolhida (não sobe para a raiz); mesma pasta em dois workspaces permitida; log `workspace.created` com `{ groupId, folders: n }` sem caminhos
- [X] T008 [P] [US1] Testes do catálogo em `tests/unit/core/catalog/extra-dirs.test.ts`: `extraDirs` `repeat` exige `{dir}` exatamente uma vez; `join` exige `{dirs}` uma vez e separador não vazio; formas inválidas recusam o catálogo com `CatalogIssue`
- [X] T009 [P] [US1] Testes de `buildLaunch` em `tests/unit/core/catalog/launch-plan-extra-dirs.test.ts`: `repeat` gera `--add-dir A --add-dir B` como argumentos separados; `join` gera `--include-directories A,B`; caminhos com espaço e acento ficam num argumento só; agente resolvido a partir de um shim `.cmd` recebe as pastas depois do alvo real (`node` + script), nunca via shell; estilo `join` omite pasta cujo caminho contém o separador; sem `extraDirs` no agente → `extraDirsApplied=false`; lista vazia → nenhum argumento; soma acima do limite de linha de comando → `INPUT_INVALID` "Pastas demais para abrir este agente de uma vez; remova algumas do workspace."
- [X] T010 [P] [US1] Testes do IPC em `tests/unit/main/ipc/register-workspace.test.ts`: `createWorkspace` e `pickFolders` (lista; `[]` ao cancelar; `defaultPath` repassado); validação (`name` 1–80, `folders` array 1–32 de string 1–`LIMITS.path`, `primaryIndex` inteiro no intervalo); atualizar `CONTRACT` em `tests/unit/preload/preload.test.ts` e os mocks em `tests/support/fake-api.ts`
- [X] T011 [P] [US1] (depende de T017) Teste de integração com PTY real em `tests/integration/core/execution/multi-folder.test.ts`: workspace com principal + duas extras; agente falso com `extraDirs` `repeat` imprime `argv` e `cwd`; esperado cwd = principal e um `--add-dir` por extra; tarefa guarda `extraDirs` (snapshot) e o relançamento usa o snapshot mesmo após mudar o workspace
- [X] T012 [P] [US1] Testes do `WorkspaceDialog` em modo criar (mais de 32 pastas bloqueado) em `tests/unit/renderer/WorkspaceDialog.test.tsx`: criar bloqueado sem nome ou sem pastas; adicionar várias pelo `pickFolders`; duplicada mostra mensagem; rádio de principal com a primeira marcada por padrão; envia `createWorkspace` com `primaryIndex`; mostra erro do main

### Implementação

- [X] T013 [US1] `createWorkspace(name, paths, primaryIndex?)` em `src/core/workspace/workspace-service.ts` usando `workspace-folders.ts`, `fs.stat` por pasta, cor e `lastOpenedAt` como em `openWorkspace` (faz T007 passar)
- [X] T014 [P] [US1] `extraDirs` em `AgentDefinition` e validação em `src/core/catalog/schema.ts` (faz T008 passar)
- [X] T015 [US1] Montagem dos argumentos de pastas extras e checagem do limite em `src/core/catalog/launch-plan.ts`, devolvendo `extraDirsApplied` (faz T009 passar)
- [X] T016 [US1] Em `src/core/workspace/workspace-service.ts` `createTask` e `src/core/execution/prepare.ts`: resolver principal e extras do workspace da tarefa (leitura única no início do lançamento), gravar `Task.extraDirs` (snapshot) e passar ao `buildLaunch`; relançamento usa o snapshot (faz a parte de argumentos e cwd de T011 passar)
- [X] T016b [US1] Em `src/core/execution/start.ts`: gravar `Execution.notices` (`extra-dirs-unsupported` quando o agente não tem a capacidade e há extras) e o log `execution.extra_dirs` `{ execId, applied, omitted: n }`, com teste em `tests/unit/core/execution/extra-dirs-notices.test.ts`
- [X] T017 [P] [US1] [simples] Acrescentar ao agente falso `--print-argv` / comando `/argv` em `tests/fixtures/fake-agent.mjs` e `extraDirs` `repeat` à entrada `fake` em `tests/fixtures/catalog.fake.json` (usados por T011)
- [X] T018 [US1] Canais `createWorkspace` e `pickFolders` em `src/shared/ipc-contract.ts`, `src/main/ipc/register-workspace.ts`, `src/main/ipc/validate-workspace.ts` e diálogo com `['openDirectory', 'multiSelections']` em `src/main/main.ts` (faz T010 passar)
- [X] T019 [US1] Componente `src/renderer/components/WorkspaceDialog.tsx` (modo criar) e entrada "Novo workspace" no "+" da barra lateral em `src/renderer/App.tsx`, com CSS em `src/renderer/styles/app.css` (faz T012 passar)
- [X] T020 [P] [US1] [simples] Declarar `extraDirs` `repeat` `["--add-dir", "{dir}"]` no Claude Code em `catalog/agents.json` e, se confirmado no T001, no Codex e no Gemini

**Checkpoint**: US1 completa e testável sozinha.

---

## Phase 4: User Story 2 — Editar as pastas de um workspace (P2)

**Goal**: adicionar, remover, trocar principal e renomear sem relançar sessões vivas.

**Independent Test**: num workspace com sessão viva, adicionar uma pasta, remover outra, trocar a principal e renomear; a sessão continua viva, o aviso aparece e o estado reaberto reflete tudo.

### Tests (escritos antes)

- [X] T021a [P] [US2] Teste do log de remoção em `tests/unit/core/workspace/rename-and-residue.test.ts`: `removeGroup` registra `workspace.removed { groupId, folders: n }` sem caminhos; implementação em `src/core/workspace/workspace-service.ts`
- [X] T021 [P] [US2] Testes de `updateWorkspace` em `tests/unit/core/workspace/update-workspace.test.ts`: `rename` (1–80), `addFolders` (duplicata e inexistente recusadas), `removeFolder` (única recusada; principal promove a próxima), `setPrimary`; nenhuma escrita em disco (FS em memória sem arquivos novos); edições concorrentes no mesmo workspace serializadas pelo `KeyedMutex`; log `workspace.updated` `{ groupId, folders: n, change }`
- [X] T022 [P] [US2] Testes do IPC `updateWorkspace` em `tests/unit/main/ipc/register-workspace.test.ts`: `change.kind` inválido, ids inexistentes, payload por tipo
- [X] T023 [P] [US2] Testes do `WorkspaceDialog` em modo editar em `tests/unit/renderer/WorkspaceDialog.test.tsx`: cada mudança chama `updateWorkspace` com o `kind` certo; botão de remover desabilitado com uma pasta; aviso "vale para terminais novos" só com sessão viva no workspace; pasta indisponível aparece marcada

### Implementação

- [X] T024 [US2] `updateWorkspace(id, change)` em `src/core/workspace/workspace-service.ts` (faz T021 passar)
- [X] T025 [US2] Canal `updateWorkspace` em `src/shared/ipc-contract.ts`, `src/main/ipc/register-workspace.ts` e `src/main/ipc/validate-workspace.ts`; documentar em `specs/001-workspace-agentes-paralelos/contracts/ipc.md` os canais novos desta feature (faz T022 passar)
- [X] T026a [P] [US2] Testes do botão "Editar workspace" e do tooltip com as pastas e a principal em `tests/unit/renderer/Tree.test.tsx`
- [X] T026 [US2] Modo editar no `src/renderer/components/WorkspaceDialog.tsx` e botão "Editar workspace" em `src/renderer/components/Tree/TreeGroup.tsx`, com tooltip listando as pastas e a principal (faz T023 passar)

**Checkpoint**: US1 e US2 funcionam sozinhas.

---

## Phase 5: User Story 3 — Navegar e ver o git de todas as pastas (P3)

**Goal**: uma raiz por pasta no explorador, principal primeiro, com git por repositório.

**Independent Test**: workspace com duas pastas git alteradas e uma comum; a aba Arquivos mostra três raízes com marcas corretas e a comum sem marcas nem erro.

### Tests (escritos antes)

- [X] T027 [P] [US3] Testes de `navigationRoots` em `tests/unit/core/files/roots.test.ts`: uma raiz por pasta, principal primeiro com `primary: true`; pasta indisponível com `available: false`; mesma pasta em dois workspaces não duplica a raiz; grupos v2 migrados continuam com uma raiz; o guard de escrita do editor (`tests/unit/core/files/files-service.test.ts`) aceita arquivo em qualquer pasta do workspace, recusa pasta indisponível e recusa `.git/`
- [X] T028 [P] [US3] Testes do explorador em `tests/unit/renderer/FileExplorer.test.tsx`: marca de principal; raiz indisponível desabilitada; raiz fora do git sem decoração e sem erro

### Implementação

- [X] T029 [US3] Raízes por pasta em `src/core/files/roots.ts` (usadas também pelo guard de escrita em `src/core/files/files-service.ts`) e `folderAvailability` calculada no snapshot em `src/core/workspace/workspace-model.ts` (faz T027 passar)
- [X] T030 [US3] Marca de principal e estado indisponível em `src/renderer/components/Files/FileExplorer.tsx` e CSS em `src/renderer/styles/app.css` (faz T028 passar)

---

## Phase 6: User Story 4 — Aviso de agente sem pastas extras (P3)

**Goal**: o usuário sabe quando a execução enxerga só a principal ou quando pastas foram omitidas.

**Independent Test**: workspace com duas pastas; abrir um shell mostra o selo "só a principal"; workspace de uma pasta não mostra selo.

### Tests (escritos antes)

- [X] T031 [P] [US4] Testes em `tests/unit/renderer/Tree.test.tsx`: execução com `notices` `extra-dirs-unsupported` mostra o selo "só a principal"; `extra-dirs-omitted` mostra "N pasta(s) indisponível(is)"; sem `notices` nenhum selo
- [X] T032 [P] [US4] Teste em `tests/unit/core/execution/extra-dirs-notices.test.ts`: principal indisponível recusa o lançamento ("A pasta principal X não está disponível."); extra indisponível é omitida e vira `extra-dirs-omitted`; workspace de uma pasta não gera aviso; relançamento com pasta do snapshot que sumiu omite e avisa; pasta sem permissão de leitura conta como indisponível

### Implementação

- [X] T033 [US4] Omissão de extras indisponíveis e recusa da principal indisponível em `src/core/execution/prepare.ts` (faz T032 passar)
- [X] T034 [US4] [simples] Selo de aviso em `src/renderer/components/Tree/TreeExecution.tsx` a partir de `execution.notices`, com CSS em `src/renderer/styles/app.css` (faz T031 passar)

---

## Phase 7: Polish & Cross-Cutting

- [X] T035 [P] e2e em `tests/e2e/multi-folder.spec.ts`: criar workspace com duas pastas pelo diálogo (diálogo nativo substituído como nos e2e existentes), abrir o agente falso e ver `--add-dir` no eco
- [X] T036 [P] [simples] Atualizar `README.md` (funcionalidades) e `docs/ideias-proximas-versoes.md` (bloco 1 marcado como planejado na feature 003)

---

## Dependencies & Execution Order

- Setup (T001) → só bloqueia T020.
- Foundational (T002–T006) bloqueia todas as histórias.
- US1 (T007–T020) é o MVP. US2 depende de US1 (reaproveita `WorkspaceDialog` e canais). US3 e US4 dependem só da Foundational e de T016 (snapshot e notices); podem correr em paralelo com US2.
- Dentro de cada história: testes → núcleo → IPC → interface.

## Parallel Examples

- Foundational: T002 ∥ T003; T006 depois de T004.
- US1: T007 ∥ T008 ∥ T009 ∥ T010 ∥ T011 ∥ T012 (testes); depois T014 ∥ T017 ∥ T020.
- US3 ∥ US4 após T016.

## Implementation Strategy

1. Foundational → US1 → validar (MVP: criar workspace e lançar com extras).
2. US2 (editar) → US3 (explorador) e US4 (avisos) em paralelo.
3. Polish (e2e, docs).
