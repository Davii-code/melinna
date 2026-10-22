# Tasks: Rodar o projeto e abrir na IDE externa

**Input**: `specs/007-rodar-projeto-ide/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

## Phase 1: Setup

- [ ] T001 [simples] Projetos de exemplo em `tests/fixtures/projects/` (`node-app` com `package.json` scripts `dev`/`test` e `package-lock.json`; `pnpm-app` com `pnpm-lock.yaml`; `maven-app` com `pom.xml` e `mvnw`; `gradle-app` com `build.gradle.kts` e plugins `application` e `org.springframework.boot`; `compose-app` com `compose.yaml`; `broken` com `package.json` inválido)
- [ ] T002 [simples] `toolsFile` (`userData/tools.json`) em `src/core/paths.ts`, com teste em `tests/unit/core/paths.test.ts`

## Phase 2: Foundational

- [ ] T003 [P] Testes do modelo em `tests/unit/core/persistence/state-schema.test.ts`: `Group.commands`, `Task.kind`, `Execution.command { commandId, label, file, args }` opcionais lidos e preservados numa regravação; ausentes = agente; nenhum aumento de `STATE_SCHEMA_VERSION`
- [ ] T004 (depende de T003) Campos opcionais em `src/core/persistence/state-schema.ts`
- [ ] T005 (depende de T004; sessão principal — muda contrato público) Tipos `RunCommand`, `DetectResult` e grupos `run` e `ide` em `src/shared/ipc-contract.ts`; códigos `PROGRAM_NOT_FOUND`, `IDE_NOT_FOUND`, `COMMAND_STALE` com mensagens em `src/core/errors.ts` (teste em `tests/unit/core/errors.test.ts`); `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`

## Phase 3: User Story 1 — Rodar comando detectado (P1) 🎯 MVP

**Goal**: menu com os comandos do projeto; rodar num painel com parar e rodar de novo.

**Independent Test**: `node-app`; rodar `dev` pelo menu e ver a saída; parar e rodar de novo.

### Tests (escritos antes)

- [ ] T006 [P] [US1] (depende de T001) Testes em `tests/unit/core/run/detect.test.ts`: scripts com npm/pnpm/yarn pelo lock; Maven com e sem `mvnw`; Gradle com `run` (plugin `application`) e `bootRun` (Spring Boot), com e sem `gradlew`; Compose (`docker-compose.yml` e `compose.yaml`; `docker-compose` legado quando `docker compose` não existe); `package.json` sem scripts não gera itens nem aviso; `package.json` inválido vira aviso; arquivo > 1 MB ignorado com aviso; ferramenta ausente → `available=false` com `searched`; no Windows, `mvnw.cmd`/`gradlew.bat` ignorados com aviso; várias pastas agrupadas
- [ ] T007 [P] [US1] Testes em `tests/unit/core/run/run-service.test.ts`: `start` resolve `commandId` no servidor (detectado e `source: custom`), comando inexistente → `COMMAND_STALE`, comando já rodando → devolve a execução com `reused: true`; programa ausente → `PROGRAM_NOT_FOUND`; nome de script com `; & $()` e espaços vira um único item de argv; valida pasta do workspace e vagas (`LIMIT_REACHED`); cria `Task { kind: 'command', isolation: 'direct' }` e `Execution { command, agentId: 'command' }`; `.cmd` do npm resolvido pelo shim; outro lote → `INPUT_INVALID`; wrapper Linux sem bit de execução → `needsConfirm: 'wrapper-sh'` e, confirmado, `sh <wrapper>`; `rerun` para (se vivo) e relança; logs `run.started { groupId, source, tool }` e `run.stopped { groupId, exitCode }` sem argumentos
- [ ] T008 [P] [US1] Integração em `tests/integration/core/run.test.ts`: rodar `npm run dev` do `node-app` (script que imprime e espera) num PTY real; saída no histórico; `rerun` grava o separador; `executions.stop` encerra; comando sobrevive a reconectar o hospedeiro
- [ ] T009 [P] [US1] Testes do IPC em `tests/unit/main/ipc/register-run.test.ts`: `list`, `start`, `rerun` com a validação de contracts/ipc.md
- [ ] T010 [P] [US1] Testes em `tests/unit/renderer/RunMenu.test.tsx`: comandos por pasta; estado vazio "Nenhum comando encontrado" com "Novo comando…"; desabilitados com "não encontrado: X"; avisos; escolher chama `start` e abre o painel; `reused` foca o painel existente; confirmação `wrapper-sh`; e em `tests/unit/renderer/Tree.test.tsx`: linha da execução de comando com ícone próprio, "Parar" e "Rodar de novo"

### Implementação

- [ ] T011 [US1] (depende de T006) `src/core/run/detect.ts`
- [ ] T011a [P] [US1] (depende de T001) Desempenho em `tests/unit/core/run/detect-perf.test.ts`: detecção em 10 pastas de fixtures em < 1 s (SC-002)
- [ ] T011b [P] [US1] Teste de arquitetura em `tests/arch/no-shell-launch.test.ts`: o lançamento de comandos e de IDE nunca usa `shell: true`, `cmd.exe`, `/c` nem `sh -c` (varre `src/core/run`, `src/core/ide`, `src/main/ipc/register-run.ts`, `register-ide.ts`) (SC-004)
- [ ] T011c [US1] (depende de T004) Testes e ajustes dos consumidores de `agentId` para execução de comando: `tests/unit/core/execution/switch-planner.test.ts` (trocar modelo/modo de execução com `command` é recusado com mensagem), `tests/unit/renderer/Tree.test.tsx`, `ExecutionTabs`/`Panel` (rótulo do comando e ícone próprio, sem nome de agente); arquivos `src/core/execution/switch-service.ts`, `src/core/execution/execution-service.ts`, `src/core/execution/prepare.ts`, `src/core/files/roots.ts`, `src/renderer/App.tsx`, `src/renderer/components/Panel/ExecutionTabs.tsx`, `src/renderer/components/Panel/Panel.tsx`, `src/renderer/components/Tree/TreeTask.tsx`, `src/renderer/components/Tree/AgentMenu.tsx`
- [ ] T012 [US1] (depende de T004, T007, T011, T011c) `src/core/run/run-service.ts` e uso de `Execution.command` em `src/core/execution/start.ts` (em vez de `catalog.buildLaunch`) e em `relaunchExecution` de `src/core/execution/lifecycle.ts`
- [ ] T013 [US1] (depende de T005, T009, T012) `src/main/ipc/register-run.ts`, `validate-run.ts`, registro em `src/main/ipc/register.ts`, montagem em `src/main/main.ts`
- [ ] T014 [US1] (depende de T010, T013) `src/renderer/components/Run/RunMenu.tsx` no "▶" de `src/renderer/components/Tree/TreeGroup.tsx`; linha de comando em `src/renderer/components/Tree/TreeExecution.tsx`; CSS em `src/renderer/styles/app.css`

**Checkpoint**: rodar comandos detectados funciona.

## Phase 4: User Story 2 — Comandos personalizados (P2)

**Goal**: criar, editar e excluir comandos do workspace e rodá-los pelo mesmo menu.

**Independent Test**: "Subir mock" com `node mock/server.js`; rodar e ver a saída.

### Tests (escritos antes)

- [ ] T015 [P] [US2] Testes em `tests/unit/core/run/custom-commands.test.ts`: nome 1–80; programa sem controle; até 64 argumentos de até 4.096 sem controle; pasta do workspace; pasta removida do workspace depois de salvo → comando desabilitado com "pasta fora do workspace"; editar; excluir; excluir com execução viva → `EXECUTION_RUNNING`; remover o workspace com comando vivo → recusado; persistência em `Group.commands`
- [ ] T016 [US2] (depois de T008, mesmo arquivo) Integração em `tests/integration/core/run.test.ts`: personalizado `node -e "console.log('oi mundo')"` preserva o argumento com espaço e aspas; programa inexistente → `AGENT_NOT_FOUND` "Programa não encontrado: X."
- [ ] T017 [US2] (depois de T009, mesmo arquivo) Testes do IPC `saveCommand`/`removeCommand` em `tests/unit/main/ipc/register-run.test.ts`
- [ ] T018 [P] [US2] Testes em `tests/unit/renderer/CommandDialog.test.tsx`: argumentos como lista de campos; validações; editar e excluir; excluir com comando rodando mostra "Pare o comando antes."

### Implementação

- [ ] T019 [US2] (depende de T012, T015) `src/core/run/custom-commands.ts` e checagem de execução viva em `removeTasksOf` de `src/core/execution/execution-service.ts`
- [ ] T020 [US2] (depende de T013, T017, T019) Canais `saveCommand`/`removeCommand` em `src/main/ipc/register-run.ts` e `validate-run.ts`
- [ ] T021 [US2] (depende de T014, T018, T020) `src/renderer/components/Run/CommandDialog.tsx` e "Novo comando…" no `RunMenu.tsx`

## Phase 5: User Story 3 — Abrir na IDE externa (P2)

**Goal**: abrir workspace, pasta ou arquivo (com linha) no VS Code/IntelliJ; informar caminho; mostrar no explorador.

**Independent Test**: com o VS Code instalado, abrir um arquivo na linha 42 a partir do editor.

### Tests (escritos antes)

- [ ] T022 [P] [US3] Testes em `tests/unit/core/ide/ide-locator.test.ts` (FS e plataforma falsos): candidatos por sistema (Windows só `.exe`: `Code.exe` em `%LOCALAPPDATA%` e `%ProgramFiles%`, `idea64.exe` em `JetBrains\IntelliJ*\bin` e em `%LOCALAPPDATA%\Programs`; `idea.cmd`/`code.cmd` nunca são candidatos; Linux `code`, `idea`, `idea.sh` no PATH e Toolbox); caminho de `tools.json` tem prioridade; inexistente volta a procurar com aviso; argumentos VS Code `--goto arquivo:linha` / pasta e IntelliJ `--line n arquivo` / pasta; `searched` preenchido
- [ ] T023 [P] [US3] Testes em `tests/unit/core/ide/tools-store.test.ts`: ausente → vazio; gravação atômica; versão maior → somente leitura; `setPath(null)` volta à detecção
- [ ] T024 [P] [US3] Testes em `tests/unit/main/ipc/register-ide.test.ts`: `locate`; `open` (spawn destacado sem shell com os argumentos certos, via fake; executável `.cmd`/`.bat` recusado); IDE ausente → `IDE_NOT_FOUND`; `choosePath` usa o diálogo nativo (fake) com filtro `.exe` no Windows e recusa lote; `resetPath`; `reveal` (`shell.showItemInFolder` via fake); `target.path` e `reveal.path` fora de pastas de workspace (após `realpath`, inclusive link simbólico para fora) recusados; `line` 1–10.000.000; logs `ide.open { kind, ok }` e `ide.reveal { ok }`
- [ ] T025 [P] [US3] Testes em `tests/unit/renderer/OpenIn.test.tsx`: "Abrir em…" no workspace, nas pastas e na aba do editor com a linha do cursor; `IDE_NOT_FOUND` → mensagem com onde procurou e botão "Escolher programa…" (chama `choosePath`)

### Implementação

- [ ] T026 [US3] (depende de T022) `src/core/ide/ide-locator.ts`
- [ ] T027 [US3] (depende de T002, T023) `src/core/ide/tools-store.ts`
- [ ] T028 [US3] (depende de T005, T013, T024, T026, T027) `src/main/ipc/register-ide.ts`, `validate-ide.ts`, registro e montagem em `src/main/main.ts`
- [ ] T029 [US3] (depende de T014, T025, T028) `src/renderer/components/Ide/OpenIn.tsx` em `src/renderer/components/Tree/TreeGroup.tsx` e na aba do editor em `src/renderer/components/Editor/EditorPane.tsx`; expor a linha do cursor do `CodeEditor` para o `EditorPane` (teste em `tests/unit/renderer/EditorPane.test.tsx`)

## Phase 6: Polish

- [ ] T030 [P] e2e em `tests/e2e/run.spec.ts`: rodar um script do `node-app` pelo menu e ver a saída no painel
- [ ] T031 [P] [simples] `README.md` (funcionalidades) e `docs/ideias-proximas-versoes.md` (níveis A e B do bloco 3 planejados na feature 007)

## Dependencies & Execution Order

- Setup → Foundational → US1 → US2; US3 depende de Foundational e de T013 (mesmos arquivos de registro do main) e pode correr em paralelo com o restante de US1/US2.
- Arquivos compartilhados (sem `[P]` entre si): `tests/integration/core/run.test.ts` (T008 → T016), `register-run.test.ts` (T009 → T017), `register-run.ts` (T013 → T020), `RunMenu.tsx` (T014 → T021), `TreeGroup.tsx` (T014 → T029), `src/main/main.ts` e `src/main/ipc/register.ts` (T013 → T028), `Tree.test.tsx` (T010 → T011c).

## Parallel Examples

- US1: T006 ∥ T007 ∥ T008 ∥ T009 ∥ T010.
- US3 em paralelo com US1/US2 depois de T013 (T029 depois de T014).

## Implementation Strategy

Foundational → US1 (MVP: rodar comando detectado) → US2 ∥ US3 → Polish.
