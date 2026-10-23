# Tasks: Configurações de execução e mapas de atalhos, no estilo do IntelliJ

**Input**: `specs/007-rodar-projeto-ide/` (plan.md, spec.md, data-model.md, contracts/ipc.md, research.md, quickstart.md)

**Tests**: toda história tem testes escritos antes da implementação; rodar testes, testar a tela e
revisar ficam com o dono do projeto. `[P]` paralelizável (arquivo diferente, sem dependência
pendente); `[simples]` delegável ao implementer.

**Regerado em 2026-10-23** para a spec nova. T001–T005 foram feitas no plano anterior e ficam; a T006
desfaz o que delas pertencia à IDE externa.

## Phase 1: Setup

- [X] T001 [simples] Projetos de exemplo em `tests/fixtures/projects/` (`node-app` com `package.json` scripts `dev`/`test` e `package-lock.json`; `pnpm-app` com `pnpm-lock.yaml`; `maven-app` com `pom.xml` e `mvnw`; `gradle-app` com `build.gradle.kts` e plugins `application` e `org.springframework.boot`; `compose-app` com `compose.yaml`; `broken` com `package.json` inválido)
- [X] T002 [simples] `toolsFile` (`userData/tools.json`) em `src/core/paths.ts`, com teste em `tests/unit/core/paths.test.ts`

## Phase 2: Foundational

- [X] T003 [P] Testes do modelo em `tests/unit/core/persistence/state-schema.test.ts`: `Group.commands`, `Task.kind`, `Execution.command { commandId, label, file, args }` opcionais lidos e preservados numa regravação; ausentes = agente; nenhum aumento de `STATE_SCHEMA_VERSION`
- [X] T004 (depende de T003) Campos opcionais em `src/core/persistence/state-schema.ts`
- [X] T005 (depende de T004; sessão principal — muda contrato público) Tipos `RunCommand`, `DetectResult` e grupos `run` e `ide` em `src/shared/ipc-contract.ts`; códigos `PROGRAM_NOT_FOUND`, `IDE_NOT_FOUND`, `COMMAND_STALE` com mensagens em `src/core/errors.ts` (teste em `tests/unit/core/errors.test.ts`); `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`
- [X] T006 (depende de T005; sessão principal — contrato) Ajuste da fundação no núcleo: `toolsFile` → `preferencesFile` (`userData/preferences.json`) em `src/core/paths.ts` e `tests/unit/core/paths.test.ts`; remover `IDE_NOT_FOUND` de `src/core/errors.ts` e do teste; mensagem de `COMMAND_STALE` "A configuração mudou; abra o seletor de novo." (com teste); em `src/core/run/types.ts` acrescentar `groupId`, `tool`, `unavailableReason` a `RunCommand` e `RunCatalog` com avisos por `groupId`
- [X] T006a (depende de T006; sessão principal — contrato) Em `src/shared/ipc-contract.ts` trocar o grupo `ide` por `prefs` (`get`, `setKeymap`, `setActiveRun`), `run.list()` sem argumento, `choice?: 'wrapper-sh' | 'system-tool'` no `start`, tipos `KeymapId`/`Preferences`; `src/preload/preload.ts`; `CONTRACT` em `tests/unit/preload/preload.test.ts`; mocks em `tests/support/fake-api.ts`
- [X] T007 [P] [simples] Campo opcional `mode` em `FileStat` (`src/core/ports/file-system.ts`), preenchido em `src/adapters/node-fs.ts` e no fake `tests/support/fakes/file-system.ts`, com teste do adaptador
- [X] T008 [P] Testes em `tests/unit/core/prefs/preferences-store.test.ts`: ausente → `windows` e `activeRun: null`; JSON inválido → padrões sem sobrescrever; gravação atômica; versão maior → `readOnly` e escrita só em memória; `keymap` inválido → `windows`
- [X] T009 (depende de T006a, T008) `src/core/prefs/preferences-store.ts`

## Phase 3: User Story 1 — Rodar pela barra de execução (P1) 🎯 MVP

**Goal**: seletor com as configurações detectadas e personalizadas, Rodar, Rodar de novo, Parar e
janela de configurações; configuração ativa lembrada.

**Independent Test**: `node-app`; escolher "dev" no seletor, Rodar, ver a saída; pelo menu, rodar de
novo e parar.

### Tests (escritos antes)

- [X] T010 [P] [US1] (depende de T001, T006) Testes em `tests/unit/core/run/detect.test.ts`: scripts com npm/pnpm/yarn pelo lock (`tool` certo); Maven com e sem `mvnw`; Gradle `build`/`test`, `run` (plugin `application`) e `bootRun` (Spring Boot), com e sem `gradlew`; Compose (`docker-compose.yml` e `compose.yaml`; `docker-compose` legado quando só ele existe); `package.json` sem scripts não gera itens nem aviso; inválido vira aviso; arquivo > 1 MB ignorado com aviso; ferramenta ausente → `available=false`, `unavailableReason='not-found'`, `searched`; no Windows, `mvnw.cmd`/`gradlew.bat` ignorados com aviso; id estável entre chamadas e diferente entre workspaces; várias pastas
- [X] T011 [P] [US1] (depende de T007) Testes em `tests/unit/core/run/resolve-program.test.ts`: executável no PATH; ausente → `PROGRAM_NOT_FOUND` "Programa não encontrado: X."; `npm.cmd`/`pnpm.cmd`/`yarn.cmd` resolvidos pelo shim para `node` + script; outro `.cmd`/`.bat` → `INPUT_INVALID` com a mensagem do contrato; wrapper sem bit de execução detectado
- [X] T012 [P] [US1] Testes em `tests/unit/core/run/custom-commands.test.ts`: nome 1–80 sem quebra; nome repetido no workspace (sem diferenciar maiúsculas) → "Já existe uma configuração com esse nome."; programa sem controle; até 64 argumentos de até 4.096 sem controle; pasta do workspace; pasta removida depois de salvo → `unavailableReason='folder-outside'`; editar; excluir; persistência em `Group.commands`
- [X] T013 [P] [US1] Testes em `tests/unit/core/run/run-service.test.ts`: `list()` junta todos os workspaces, personalizadas antes das detectadas; `start` resolve `commandId` no servidor (detectada e personalizada); inexistente → `COMMAND_STALE`; viva → `reused: true`; encerrada → relança a mesma execução com programa resolvido de novo; sem anterior → cria `Task { kind: 'command', isolation: 'direct' }` e `Execution { agentId: 'command', command }`; vagas (`LIMIT_REACHED`); nome de script com `; & $()` e espaços vira um item de argv; wrapper sem bit → `needsConfirm`; `wrapper-sh` → `sh <wrapper> <args>`; `system-tool` → `mvn`/`gradle`; `rerun` para (se viva) e relança; `removeCommand` com execução viva → `EXECUTION_RUNNING` "Pare o comando antes."; `rerun` resolve de novo e atualiza `exec.command` (sumiu → `COMMAND_STALE`, programa ausente → `PROGRAM_NOT_FOUND`); dois `start` simultâneos da mesma configuração → uma execução e um `reused: true`; `choice` recusado quando a configuração não usa wrapper sem bit; logs `run.started`/`run.stopped`/`run.command_saved`/`run.command_removed` sem argumentos, programas nem caminhos
- [X] T014 [P] [US1] Integração em `tests/integration/core/run.test.ts`: `npm run dev` do `node-app` num PTY real com a saída no histórico; segundo `start` reusa; `rerun` grava o separador; `executions.stop` encerra; personalizado `node -e "console.log('oi mundo')"` preserva o argumento com espaço e aspas; programa inexistente → `PROGRAM_NOT_FOUND`; processo que ignora Ctrl+C é encerrado após o prazo de parada (5 s); depois de reiniciar o serviço (novo `ExecutionService` sobre o mesmo estado), o comando vivo é reconciliado com o hospedeiro, mantém `Execution.command` e `rerun` funciona
- [X] T015 [P] [US1] Testes do IPC em `tests/unit/main/ipc/register-run.test.ts` (`list`, `start`, `rerun`, `saveCommand`, `removeCommand`) e `tests/unit/main/ipc/register-prefs.test.ts` (`get`, `setKeymap`, `setActiveRun`) com a validação de contracts/ipc.md; log `prefs.keymap_changed { keymap }`
- [X] T016 [P] [US1] Testes em `tests/unit/renderer/RunBar.test.tsx` e `RunSelector.test.tsx`: seletor agrupado por workspace e pasta, personalizadas primeiro; "Nenhuma configuração" com "Editar configurações"; desabilitadas com "não encontrado: X" e "pasta fora do workspace"; avisos; indicação de rodando; ▶ desabilitado com "Escolha uma configuração"; ativa sumida → "Nenhuma configuração ativa"; escolher grava `setActiveRun`; ▶ chama `start` e abre o painel; `reused` foca o painel; confirmação `wrapper-sh`/`system-tool`; ⋮ "Rodar de novo" e "Parar" (desabilitados com a ativa parada; "Editar configurações" sempre); ▶ desabilitado com o motivo quando a ativa está desabilitada
- [X] T017 [P] [US1] Testes em `tests/unit/renderer/RunConfigDialog.test.tsx`: lista à esquerda e campos à direita; argumentos como lista de campos; criar, editar, duplicar, excluir; detectada só leitura com "Duplicar"; duplicar sugere "<nome> (cópia)" (com número se já existir); validações; excluir rodando mostra "Pare o comando antes."
- [X] T018 [P] [US1] Testes em `tests/unit/core/execution/switch-planner.test.ts` (ou `switch-service.test.ts`) e `tests/unit/renderer/Tree.test.tsx`: troca de modelo/modo em execução de comando recusada com mensagem; remover o workspace (`removeTasksOf`) com comando vivo → `EXECUTION_RUNNING` "Pare o comando antes."; linha da execução de comando com ícone próprio e rótulo, sem nome de agente
- [X] T019 [P] [US1] Teste de arquitetura em `tests/arch/no-shell-launch.test.ts` (nenhum `shell: true`, `cmd.exe`, `/c`, `sh -c` em `src/core/run` e `src/main/ipc/register-run.ts`) e desempenho em `tests/unit/core/run/detect-perf.test.ts` (10 pastas < 1 s, SC-002)

### Implementação

- [X] T021 [US1] (depende de T007, T011) `src/core/run/resolve-program.ts`
- [X] T020 [US1] (depende de T010, T021) `src/core/run/detect.ts`
- [X] T022 [US1] (depende de T012) `src/core/run/custom-commands.ts`
- [X] T023 [US1] (depende de T018) Lançamento de execução de comando: `src/core/execution/start.ts` (usa `exec.command` em vez de `catalog.buildLaunch`), `lifecycle.ts` (`relaunchExecution`), `prepare.ts` (sem catálogo); decisão por `exec.command`/`Task.kind`, nunca por `agentId`
- [X] T023a [US1] (depende de T018, T023) Consumidores de execução de comando: `src/core/execution/switch-service.ts` (recusa troca), `execution-service.ts` (`removeTasksOf` recusa comando vivo), `src/core/files/roots.ts`
- [X] T024 [US1] (depende de T013, T014, T020–T023a) `src/core/run/run-service.ts`
- [X] T025 [US1] (depende de T009, T015, T024) `src/main/ipc/register-run.ts`, `validate-run.ts`, `register-prefs.ts`, `validate-prefs.ts`, registro em `src/main/ipc/register.ts`, montagem em `src/main/main.ts`
- [X] T026 [US1] (depende de T025) `src/renderer/store/run-store.ts` (catálogo, ativa via `prefs`, rodar/rodar de novo/parar, foco com `layout-store.open`)
- [X] T027 [US1] (depende de T016, T026) `src/renderer/components/Run/RunBar.tsx` e `RunSelector.tsx` no slot de `src/renderer/components/TopBar.tsx`; CSS em `src/renderer/styles/app.css`
- [X] T028 [US1] (depende de T017, T027) `src/renderer/components/Run/RunConfigDialog.tsx`
- [X] T029 [US1] (depende de T018, T023a) Rótulo e ícone de comando em `src/renderer/components/Tree/TreeExecution.tsx`, `TreeTask.tsx`, `AgentMenu.tsx`, `src/renderer/components/Panel/ExecutionTabs.tsx`, `Panel.tsx`, `src/renderer/App.tsx`

**Checkpoint**: rodar pela barra funciona.

## Phase 4: User Story 2 — Escolher o mapa de atalhos (P2)

**Goal**: quatro mapas; troca imediata e persistida; atalhos com terminal ou editor em foco.

**Independent Test**: escolher IntelliJ e abrir "ir para arquivo" com Ctrl+Shift+N; voltar a Windows
e abrir com Ctrl+P.

### Tests (escritos antes)

- [X] T030 [P] [US2] Testes em `tests/unit/renderer/keymaps.test.ts`: tabela de research R8; os 4 mapas cobrem as 7 ações (tecla ou `null`); nenhum usa Ctrl+C/D/Z/B, setas nem teclas reservadas; sem tecla repetida no mesmo mapa; `Mod` = Cmd no macOS; `shortcutLabel`
- [X] T031 [P] [US2] Testes em `tests/unit/renderer/use-shortcuts.test.tsx`: para cada mapa, cada ação dispara com foco no terminal (textarea do xterm) e no editor; atalho de outro mapa não faz nada e não chama `preventDefault`; troca de mapa vale na hora; Rodar/Parar chamam o `run-store`
- [X] T032 [P] [US2] Testes em `tests/unit/renderer/KeymapDialog.test.tsx`: opções com a atual marcada e a tabela de cada uma; escolher chama `prefs.setKeymap`; dicas/títulos (`EditorPane`, `TopBar`, `RunBar`) mostram a tecla do mapa atual

### Implementação

- [X] T033 [US2] (depende de T030) `src/renderer/keymap/keymaps.ts`
- [X] T034 [US2] (depende de T025, T031, T033) `src/renderer/keymap/keymap-store.ts` e `use-shortcuts.ts`, substituindo os ouvintes de teclado de `src/renderer/App.tsx` (Ctrl+S do `EditorPane` passa pelo mapa); log `prefs.keymap_changed` no main (T025)
- [X] T035 [US2] (depende de T032, T034) `src/renderer/components/Settings/KeymapDialog.tsx`, botão na barra superior e `shortcutLabel` nas dicas de `EditorPane.tsx`, `TopBar.tsx`, `RunBar.tsx`

## Phase 5: Polish

- [X] T036 [P] e2e em `tests/e2e/run.spec.ts`: escolher "dev" do `node-app`, Rodar e ver a saída; trocar para o mapa IntelliJ e abrir "ir para arquivo" com Ctrl+Shift+N
- [X] T037 [P] [simples] `README.md` (funcionalidades: barra de execução e mapas de atalhos) e `docs/ideias-proximas-versoes.md` (IDE externa e edição de atalhos individuais ficam para depois)

## Dependencies & Execution Order

- Setup → Foundational (T006–T009) → US1 → US2 → Polish. US2 depende de T025 (`prefs` no main) e de
  T026 (ações Rodar/Parar do `run-store`).
- Arquivos compartilhados: `src/shared/ipc-contract.ts` (T005 → T006a), `register.ts`/`main.ts` (T025),
  `App.tsx` (T029 → T034), `TopBar.tsx` (T027 → T035), `Tree.test.tsx` (T018).

## Parallel Examples

- Foundational: T007 ∥ T008 (T006 → T006a em série: mesmos tipos).
- US1 testes: T010 ∥ T011 ∥ T012 ∥ T013 ∥ T014 ∥ T015 ∥ T016 ∥ T017 ∥ T018 ∥ T019.
- US2 testes: T030 ∥ T031 ∥ T032.

## Implementation Strategy

Foundational → US1 (MVP: rodar pela barra) → US2 (mapas) → Polish.
