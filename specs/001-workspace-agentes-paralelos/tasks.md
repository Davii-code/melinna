# Tasks: Workspace de agentes paralelos (primeira fatia)

**Input**: `specs/001-workspace-agentes-paralelos/` (spec.md, plan.md, research.md, data-model.md, contracts/)

**Tests**: obrigatórios (Princípio V). Em cada história e no Polish, as tasks da seção "Testes" são escritas antes das de implementação e falham até a implementação existir; cada task de implementação indica os testes que faz passar e não escreve testes novos. Na fundação, cada task escreve primeiro o seu teste e depois o código, na mesma task, porque são peças pequenas sem história própria.

**Fora das tasks**: rodar testes, testar no navegador, revisar e configurar CI são feitos pelo dono do projeto.

## Format: `[ID] [P?] [Story] [simples?] Descrição — arquivos`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[USn]**: história da spec
- **[simples]**: pode ser delegada ao `implementer`; as demais ficam com a sessão principal

---

## Phase 1: Setup

- [X] T001 [simples] Criar `package.json` (nome `melinna-desk`, `private`, `main: out/main/main.js`; scripts `dev`, `build`, `test:unit`, `test:integration`, `test:perf`, `test:arch`, `test:e2e`, `lint`, `format`, `postinstall: electron-rebuild -f -w node-pty`) com as dependências da tabela do plan, cada uma na versão exata mais recente da linha indicada (Electron 44.x, node-pty 1.1.x, xterm 6.x, React 19.x, `@types/node` 24.x), sem `^`/`~`; e `.gitignore` (`node_modules/`, `out/`, `dist/`, `coverage/`, `test-results/`) — `package.json`, `.gitignore`
- [X] T002 [P] [simples] Criar `tsconfig.json` (referências), `tsconfig.node.json` (core, adapters, host, main, preload, shared, testes não-jsdom; `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) e `tsconfig.web.json` (renderer, shared; lib DOM, sem tipos Node) — `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- [X] T003 [P] Configurar `electron.vite.config.ts` com entradas `main` (`src/main/main.ts` e `src/host/main.ts` → `out/host/main.js`), `preload` e `renderer` (React), `node-pty` externo — `electron.vite.config.ts`
- [X] T004 [P] Configurar `vitest.config.ts` com projetos `unit` (`tests/unit/**`, `node`; `jsdom` em `tests/unit/renderer/**`), `integration` (`tests/integration/**`, `pool: 'forks'`, timeout 30 s), `perf` (`tests/perf/**`, `pool: 'forks'`, sem paralelismo de arquivos, timeout 120 s) e `arch` (`tests/arch/**`); criar `scripts/vitest-electron-node.mjs`, que executa o Vitest com o binário do Electron e `ELECTRON_RUN_AS_NODE=1` via `child_process.spawn` sem shell, repassando argumentos e código de saída — `vitest.config.ts`, `scripts/vitest-electron-node.mjs`
- [X] T005 [P] [simples] Configurar `playwright.config.ts` para `tests/e2e/**` com `_electron`, sem paralelismo, `userData` temporário por teste via `MELINNA_USER_DATA` — `playwright.config.ts`
- [X] T006 [P] [simples] Configurar `eslint.config.js` (typescript-eslint estrito; `no-warning-comments` para `TODO`/`FIXME`/`XXX`; `no-restricted-syntax` proibindo `it.skip`, `it.only`, `it.todo`, `describe.skip`, `describe.only`, `test.skip`, `test.only`; `no-restricted-imports` de `exec`/`execSync` de `child_process`) e `.prettierrc` — `eslint.config.js`, `.prettierrc`
- [X] T007 [P] Criar `scripts/render-icons.mjs`, que abre `docs/brand/logo.svg` numa `BrowserWindow` oculta e grava `build/icons/icon.png` (512×512) e `build/icons/icon-256.png` com `capturePage`, sem dependência nova — `scripts/render-icons.mjs`
- [X] T008 [P] [simples] Criar `electron-builder.yml` (appId `io.github.davii-code.melinna`, productName `Melinna`, executableName `melinna-desk`, NSIS, `asarUnpack` de `node_modules/node-pty/**` e `out/host/**`, `electronFuses.runAsNode: true`, ícone `build/icons/icon-256.png`) — `electron-builder.yml`

---

## Phase 2: Foundational (bloqueia todas as histórias)

- [X] T009 Escrever `tests/arch/boundaries.test.ts` (API do compilador TypeScript) que reprova: `src/core/**` importando `electron`, `node-pty`, `react`, `react-dom`, `@xterm/*` ou arquivos de `src/main|preload|renderer|host|adapters`; `src/adapters/**` e `src/host/**` importando `electron`; `src/renderer/**` importando built-ins do Node, `src/main` ou `src/core` (exceto `src/core/layout`). Com fixtures violadoras que o teste confirma reprovar — `tests/arch/boundaries.test.ts`, `tests/arch/fixtures/**`
- [X] T010 [P] [simples] Teste e implementação de `MelinnaError` com a união fechada de códigos do plan (inclui `HOST_AUTH`, `HOST_VERSION`, `INPUT_INVALID`, `WORK_WOULD_BE_LOST`, `INTERNAL`), `userMessage` pt-BR por código, `details`, `cause`, `isMelinnaError`, `toIpcError` (desconhecido → `INTERNAL`); e `newId()` — `src/core/errors.ts`, `src/core/ids.ts`, `tests/unit/core/errors.test.ts`
- [X] T011 [P] Teste e implementação dos tipos do protocolo do hospedeiro (todas as mensagens de `contracts/host-protocol.md`, incluindo `ack` e marcas `replay-start`/`replay-end`) e do `frame-codec` (prefixo de comprimento, quadros fragmentados, limite de 1 MB, JSON inválido → `HOST_PROTOCOL`) — `src/core/contracts/host-protocol.ts`, `src/core/contracts/frame-codec.ts`, `tests/unit/core/contracts/frame-codec.test.ts`
- [X] T012 [P] [simples] Declarar as portas `Logger`, `Clock`, `Platform` e criar fakes (logger em memória, relógio controlável, plataforma configurável) com testes dos fakes — `src/core/ports/logger.ts`, `src/core/ports/clock.ts`, `src/core/ports/platform.ts`, `tests/support/fakes/logger.ts`, `tests/support/fakes/clock.ts`, `tests/unit/support/fakes-basic.test.ts`
- [X] T013 [P] Declarar as portas `FileSystem` e `ProcessRunner` e criar fakes (fs em memória com injeção de erro por caminho e código, runner programável por comando) com testes dos fakes — `src/core/ports/file-system.ts`, `src/core/ports/process-runner.ts`, `tests/support/fakes/file-system.ts`, `tests/support/fakes/process-runner.ts`, `tests/unit/support/fakes-io.test.ts`
- [X] T014 Declarar a porta `HostClient` (usa os tipos de T011, inclui `ack`) e criar `FakeHostClient` com teste — `src/core/ports/host-client.ts`, `tests/support/fakes/host-client.ts`, `tests/unit/support/fake-host-client.test.ts`
- [X] T015 Teste e implementação do logger JSON Lines (`child`, níveis, `err`) e do sink com rotação a 5 MB e 3 arquivos; campos `prompt`, `input`, `output`, `env` são descartados com aviso — `src/core/log/logger.ts`, `src/core/log/jsonl-sink.ts`, `tests/unit/core/log/logger.test.ts`
- [X] T016 [P] [simples] Teste e implementação da gravação atômica (`.tmp` + `fsyncFile` + `rename`; em erro remove o `.tmp` e mantém o original) — `src/core/persistence/atomic-file.ts`, `tests/unit/core/persistence/atomic-file.test.ts`
- [X] T017 Teste e implementação de `state-schema` e `state-store` (carregar, salvar atômico com debounce de 300 ms, corrompido → `state.corrupt-<data>.json` e workspace vazio com aviso, `schemaVersion` maior → somente leitura) — `src/core/persistence/state-schema.ts`, `src/core/persistence/state-store.ts`, `tests/unit/core/persistence/state-store.test.ts`
- [X] T018 [P] [simples] Teste e implementação de `paths.ts` (layout de `userData` do data-model e `repoId`, sem diferenciar maiúsculas no Windows) — `src/core/paths.ts`, `tests/unit/core/paths.test.ts`
- [X] T019 Teste e implementação dos adaptadores Node: `NodeFileSystem`, `NodeProcessRunner` (`execFile`, `shell: false`, `windowsHide`, timeout, saída binária até 50 MB), `NodePlatform`, `NodeClock` — `src/adapters/node-fs.ts`, `src/adapters/node-process-runner.ts`, `src/adapters/node-platform.ts`, `src/adapters/node-clock.ts`, `tests/integration/adapters/node-adapters.test.ts`
- [X] T020 [P] Teste e implementação do `GitRunner` (`-c core.quotepath=off`, leituras com `--no-optional-locks`, `GIT_FAILED` com stderr truncado a 2 KB, sem argumentos de usuário no log) — `src/core/git/git-runner.ts`, `tests/unit/core/git/git-runner.test.ts`
- [X] T021 [P] [simples] Teste e implementação do mutex assíncrono por chave (`repoId`): ordem FIFO, liberação em erro, chaves diferentes não se bloqueiam — `src/core/git/repo-mutex.ts`, `tests/unit/core/git/repo-mutex.test.ts`
- [X] T022 Teste e implementação dos utilitários de git para testes: `createTempRepo` (commits, branches, binários, N arquivos gerados) e `snapshotMainTree`/`expectMainTreeUnchanged` (HEAD, branch, hash de `.git/index`, hash dos arquivos fora de `.git`) — `tests/support/git-fixture.ts`, `tests/support/main-tree-invariant.ts`, `tests/integration/support/git-fixture.test.ts`
- [X] T023 [P] Criar o agente falso e o catálogo de teste. Agente: imprime os argumentos em JSON na primeira linha; ecoa linhas com prefixo `echo:`; emite cores ANSI; imprime `size=<cols>x<rows>` no início e a cada redimensionamento; `/model X` → `model=X`; `/permission X` → `permission=X`; `/busy N` (saída contínua por N ms); `query-cursor` (envia `ESC[6n`, espera a resposta até 5 s e imprime `cpr=<linha>;<coluna>` ou `cpr=timeout`); `flood N` (N MB de saída numerada); `spawn-child` (neto que fica vivo); `ignore-sigint` (não sai com Ctrl+C); `exit N`. Catálogo: `fake` (enunciado por argumento; modelo e permissão por `pty-command`), `fake-pty` (enunciado por PTY), `fake-resume` (modelo e permissão por `restart-resume`), `fake-nosw` (`unsupported`) — `tests/fixtures/fake-agent.mjs`, `tests/fixtures/catalog.fake.json`
- [X] T024 [P] [simples] Teste e implementação dos tokens de tema (paleta da spec em variáveis CSS) e de `bands.ts` (`bandColor(i)` = faixas[i % 6]; `bandLabel(i)` = `i + 1` quando i ≥ 6, sem teto) — `src/renderer/theme/tokens.css`, `src/renderer/theme/bands.ts`, `tests/unit/renderer/theme/bands.test.ts`

**Checkpoint**: fundação pronta.

---

## Phase 3: User Story 1 — Lançar e conversar (P1) 🎯 MVP

**Goal**: lançar uma tarefa em vários agentes, cada um em branch, worktree e PTY próprios, e conversar.

**Independent Test**: 3 execuções do agente falso num repositório temporário; entrada e saída por painel; árvore principal inalterada.

### Testes da US1 (escrever antes)

- [X] T025 [P] [US1] Validação do catálogo: obrigatórios, id inválido, placeholder parcial, `restart-resume` sem `resume`, shell com `model`, padrão fora da lista, `platforms`, inválida não derruba as válidas — `tests/unit/core/catalog/validate.test.ts`
- [X] T026 [P] [US1] Carga e mesclagem (embutido + usuário por `id`, usuário ausente, JSON inválido do usuário vira `invalid`) — `tests/unit/core/catalog/load.test.ts`
- [X] T027 [P] [US1] Montagem do lançamento: ordem dos argumentos, placeholder só em elemento inteiro, modelo personalizado pelo regex (`INPUT_INVALID`), enunciado com `\0` → `PROMPT_INVALID`, enunciado acima de 30.000 caracteres no Windows vai para `promptViaPty`, `delivery: pty` e `none` — `tests/unit/core/catalog/launch-plan.test.ts`
- [X] T028 [P] [US1] Resolução e detecção: PATH + PATHEXT, caminho absoluto, ausente → não instalado com nome procurado, `.cmd` com `npmShim` → `node <script>` ou `.exe`, `.cmd` sem resolução → `UNSAFE_LAUNCHER`, `.cmd`/`.bat` nunca devolvido como `file` — `tests/unit/core/catalog/resolve-executable.test.ts`
- [X] T029 [P] [US1] Catálogo embutido: `catalog/agents.json` inteiro passa na validação; agentes têm `verifiedWith`; shells declaram `platforms`; modos que desligam confirmações estão `dangerous` — `tests/unit/core/catalog/builtin-catalog.test.ts`
- [X] T030 [P] [US1] Slug (acentos, símbolos, 40 caracteres, vazio → `tarefa`), branch `melinna/<slug>/<agente>`, sufixos `-2`, `-3` — `tests/unit/core/git/branch-name.test.ts`
- [X] T031 [P] [US1] Máquina de estados (todas as transições do data-model, incluindo `starting`, e rejeição das inválidas) e limite (12 vivas, `LIMIT_REACHED`, vagas) — `tests/unit/core/execution/state-machine.test.ts`, `tests/unit/core/execution/limits.test.ts`
- [X] T032 [P] [US1] Integração de repositório, lease e worktree com git real: não-git → `REPO_INVALID`; ref inexistente → `BASE_REF_NOT_FOUND`; contagem de não commitadas; worktree no commit base dentro de `userData`; lease adquirido antes do worktree e `WORKTREE_IN_USE` para outra execução; lease mantido para a mesma execução; falha na criação desfaz worktree e libera lease; diretório solto, worktree registrado sem execução e lease órfão → `WORKTREE_RESIDUE` com `residuePath`; limpeza recusa caminho fora da pasta de worktrees; 6 preparos simultâneos no mesmo repositório terminam sem erro de lock; colisão de branch gera sufixo; `expectMainTreeUnchanged` em todos — `tests/integration/core/git/worktree.test.ts`
- [X] T033 [P] [US1] Integração básica do hospedeiro: handshake; token errado → `HOST_AUTH` e fechamento; versão diferente → `HOST_VERSION`; sem `hello` em 2 s → fechamento; `file` relativo e `file` `.cmd`/`.bat` recusados; spawn, eco e cores; `resize` reflete em `size=`; `resize` fora dos limites ignorado; `exit` com código; `activity` no máximo a cada 250 ms — `tests/integration/host/host-basic.test.ts`
- [X] T034 [P] [US1] Unidade do `TerminalQueryResponder`: reconhece DA1, DA2, DSR 5, CPR e OSC 10/11 com terminador BEL e ST, inclusive divididos entre pedaços de saída; respostas conforme a tabela do contrato; não responde com conexão anexada fora de reprodução — `tests/unit/host/query-responder.test.ts`
- [X] T035 [P] [US1] Integração das consultas: `query-cursor` sem conexão anexada recebe resposta do hospedeiro (`cpr=` com a última linha); com conexão anexada o hospedeiro não responde e a resposta enviada pelo cliente chega ao agente — `tests/integration/host/query-responder.test.ts`
- [X] T036 [P] [US1] Integração do controle de fluxo: `flood 20` anexado sem `ack` para de entregar após 1 MB sem confirmação; `ack` retoma; ao final todos os bytes chegam em ordem; sem conexão anexada o PTY nunca é pausado; desanexar retoma — `tests/integration/host/flow-control.test.ts`
- [X] T037 [P] [US1] Integração do `ExecutionService.launch` com hospedeiro e git reais: 3 picks geram 3 worktrees e 3 processos, cada worktree existe antes do seu `spawn`; enunciado por argumento chega no JSON; enunciados adversariais (aspas, `\"`, barra invertida no fim, `%PATH%`, `&`, `|`, `^`, `<`, `>`, quebra de linha, tabulação, emoji, CJK) chegam íntegros; enunciado por PTY chega após a primeira saída; executável sumido → só aquela execução em `failed_to_start` com worktree mantido; logs do teste não contêm o enunciado nem a entrada digitada; árvore principal inalterada — `tests/integration/core/execution/launch.test.ts`
- [X] T038 [P] [US1] `WorkspaceService`: criar grupo e tarefa, snapshot imutável, `subscribe`, persistência por `state-store`, `inspectRepo` encaminhado — `tests/unit/core/workspace/workspace-service.test.ts`
- [X] T039 [P] [US1] IPC dos domínios `catalog`, `workspace` (sem `cleanResidue`) e `tasks`: validação de tipos e tamanhos de `contracts/ipc.md` (`INPUT_INVALID`), ids inexistentes, mapeamento de `MelinnaError` e `INTERNAL` para `Result` — `tests/unit/main/ipc/validate-common.test.ts`, `tests/unit/main/ipc/register-catalog.test.ts`, `tests/unit/main/ipc/register-workspace.test.ts`, `tests/unit/main/ipc/register-tasks.test.ts`
- [X] T040 [P] [US1] Ponte de terminal no principal: `terminal:open` cria canal, envia `port2` por `webContents.postMessage('terminal:port', { execId, channelId }, [port2])` e resolve `{ channelId }`; encaminha `data`, `marker` (incluindo `replay-start`/`replay-end`) e `exit`; aceita `input` ≤ 64 KB e `resize` nos limites; repassa `ack`; `terminal:close` desanexa sem matar — `tests/unit/main/ipc/terminal-ports.test.ts`
- [X] T041 [P] [US1] Preload: `window.melinna` expõe exatamente as chaves de `contracts/ipc.md`; ao receber `terminal:port`, repassa com `window.postMessage({ source: 'melinna-terminal', execId, channelId }, location.origin, [port])` — `tests/unit/preload/preload.test.ts`
- [X] T042 [P] [US1] Receptor de port na página: aceita só `event.source === window`, origem igual, `source: 'melinna-terminal'` e `channelId` pendente; ignora o resto; resolve a espera do `terminal.open` — `tests/unit/renderer/terminal/port-receiver.test.ts`
- [X] T043 [P] [US1] Janela e instância única (APIs do Electron simuladas): opções `sandbox`, `contextIsolation`, `nodeIntegration: false`; CSP `default-src 'self'; style-src 'self' 'unsafe-inline'`; `will-navigate` bloqueado; `setWindowOpenHandler` nega; segunda instância foca a janela existente e a nova sai — `tests/unit/main/window.test.ts`, `tests/unit/main/single-instance.test.ts`
- [X] T044 [P] [US1] `host-launcher` com fakes: reaproveita hospedeiro do `endpoint` com `welcome`; `endpoint` com pid morto inicia novo; início com `ELECTRON_RUN_AS_NODE=1`, `detached`, `windowsHide`, `unref`; sem `welcome` em 5 s → `HOST_UNAVAILABLE` — `tests/unit/main/host-launcher.test.ts`
- [X] T045 [P] [US1] Saída ociosa do hospedeiro com relógio falso: sai após 60 s sem processos e sem conexão; conexão ou `spawn` reinicia a contagem; não sai com processo vivo — `tests/unit/host/idle-exit.test.ts`
- [X] T046 [P] [US1] `NewTaskDialog`: agentes "não encontrado" desmarcáveis com nome procurado; vagas impedem excesso; aviso de não commitadas exige "Lançar mesmo assim"; enunciado vazio bloqueado; `picks` com modelo e modo padrão — `tests/unit/renderer/NewTaskDialog.test.tsx`
- [X] T047 [P] [US1] `TerminalView` (xterm simulado): escreve bytes; envia entrada; resize com atraso ≤ 100 ms e mínimo 20×5; oculto não envia; perda de WebGL troca para DOM; entre `replay-start` e `replay-end` descarta `onData`; envia `ack` a cada 256 KB processados; marcas `discarded`, `gap` e `separator` viram linhas visíveis com texto pt-BR — `tests/unit/renderer/TerminalView.test.tsx`
- [X] T048 [P] [US1] Layout automático: 1 a 12 painéis, mínimo de 40×10 células, transbordo com rolagem — `tests/unit/core/layout/auto.test.ts`
- [X] T049 [P] [US1] Casca da interface: `TopBar` com wordmark e botão de nova tarefa; `workspace-store` reflete `workspace.onChange` — `tests/unit/renderer/TopBar.test.tsx`, `tests/unit/renderer/workspace-store.test.ts`
- [X] T050 [P] [US1] `Panel`, `PanelHeader` (faixa, número a partir da 7ª, agente, modelo, modo, estado) e `Grid` no modo automático — `tests/unit/renderer/Panel.test.tsx`, `tests/unit/renderer/Grid-auto.test.tsx`
- [X] T051 [P] [US1] Desempenho: SC-001 (6 execuções do agente falso, repositório de 1.000 arquivos, ≤ 6 s até o 6º `spawn`) e SC-002 no trecho principal ↔ hospedeiro (p95 do eco de 1.000 teclas ≤ 30 ms) — `tests/perf/launch.perf.test.ts`, `tests/perf/echo-latency.perf.test.ts`
- [X] T052 [P] [US1] E2E: catálogo falso no `userData` de teste, repositório temporário, criar grupo, lançar `fake` e `fake-pty`, digitar em cada painel e ver o eco — `tests/e2e/launch-and-converse.spec.ts`

### Implementação da US1

- [X] T053 [US1] Tipos e validação do catálogo (passa T025) — `src/core/catalog/schema.ts`, `src/core/catalog/validate.ts`
- [X] T054 [US1] Carga e mesclagem (passa T026) — `src/core/catalog/load.ts`
- [X] T055 [US1] Placeholders e `buildLaunch` (passa T027) — `src/core/catalog/placeholders.ts`, `src/core/catalog/launch-plan.ts`
- [X] T056 [US1] `resolveExecutable`, `resolveNpmShim`, `detect` (passa T028) — `src/core/catalog/resolve-executable.ts`, `src/core/catalog/npm-shim.ts`, `src/core/catalog/detect.ts`
- [X] T057 [US1] Entrada `claude`, conferindo cada flag com `claude --help` e preenchendo `verifiedWith` — `catalog/agents.json`
- [X] T058 [US1] Entrada `codex` (conferir `codex --help`; permissão como combinações de `--sandbox` e `--ask-for-approval`; modo sem sandbox e sem aprovação `dangerous`) — `catalog/agents.json`
- [X] T059 [US1] Entrada `gemini` (conferir `gemini --help`; sem troca em voo usar `restart-resume` se houver retomada, senão `unsupported`; `yolo` `dangerous`) — `catalog/agents.json`
- [X] T060 [US1] [simples] Entradas de shell com `platforms`: `pwsh`, `powershell`, `cmd`, `git-bash` (Windows), `bash`, `zsh` (macOS/Linux) (com T057–T059, passa T029) — `catalog/agents.json`
- [X] T061 [US1] Slug e nome de branch com `check-ref-format` e sufixo livre (passa T030) — `src/core/git/branch-name.ts`
- [X] T062 [US1] `inspectRepo` (raiz, commit da base, não commitadas por `status --porcelain=v1 -z` sem lock) — `src/core/git/repo.ts`
- [X] T063 [US1] Lease: adquirir com `wx`, verificar dono, liberar — `src/core/git/lease.ts`
- [X] T064 [US1] `createWorktree` e `removeWorktree` básicos sob o mutex do repositório, desfazendo em falha — `src/core/git/worktree.ts`
- [X] T065 [US1] Detecção e limpeza de resíduo (diretório solto, worktree registrado sem execução, lease órfão; só dentro da pasta de worktrees) (com T061–T064, passa T032) — `src/core/git/residue.ts`
- [X] T066 [US1] Máquina de estados e limites (passa T031) — `src/core/execution/state-machine.ts`, `src/core/execution/limits.ts`
- [X] T067 [US1] Autenticação do hospedeiro (token com permissão restrita, comparação em tempo constante) — `src/host/auth.ts`
- [X] T068 [US1] Servidor do hospedeiro: pipe/socket, handshake com prazo de 2 s e versão, despacho, limite de quadro, recusa de `file` relativo e `.cmd`/`.bat` — `src/host/server.ts`
- [X] T069 [US1] `NodePtyAdapter` e `PtySupervisor` (spawn com `file` absoluto, `cwd`, `env` com `TERM`, `COLORTERM`, `MELINNA_EXECUTION_ID`; escrita; resize com limites; deslocamentos; `exit`; `activity` limitado) — `src/host/node-pty-adapter.ts`, `src/host/pty-supervisor.ts`
- [X] T070 [US1] `TerminalQueryResponder` e ligação ao supervisor (passa T034 e T035) — `src/host/query-responder.ts`, `src/host/pty-supervisor.ts`
- [X] T071 [US1] Controle de fluxo com marcas de 1 MB e 256 KB e `ack` (passa T036) — `src/host/flow-control.ts`, `src/host/pty-supervisor.ts`
- [X] T072 [US1] Entrada do hospedeiro e saída ociosa (lê `userData`, grava `host/endpoint`, logger em `logs/host.log`) (passa T033 e T045) — `src/host/main.ts`, `src/host/idle-exit.ts`
- [X] T073 [US1] `host-launcher` (passa T044) — `src/main/host-launcher.ts`
- [X] T074 [US1] `NodeHostClient` implementando `HostClient` sobre o pipe/socket e o `frame-codec` — `src/main/host-client.ts`
- [X] T075 [US1] `WorkspaceService` e `workspace-model` (passa T038) — `src/core/workspace/workspace-service.ts`, `src/core/workspace/workspace-model.ts`
- [X] T076 [US1] Preparo de execução: limite, lançamento pelo catálogo, branch, lease e worktree em série sob o mutex, `bandIndex`, falha isolada com desfazer — `src/core/execution/prepare.ts`
- [X] T077 [US1] Início de execução e entrega do enunciado por PTY após a primeira saída — `src/core/execution/start.ts`, `src/core/execution/prompt-delivery.ts`
- [X] T078 [US1] Fachada `ExecutionService` (`launch` iniciando cada execução quando seu preparo termina, `write`, `resize`, `attach`, `ack`, `liveCount`, persistência de estado) (com T076 e T077, passa T037) — `src/core/execution/execution-service.ts`
- [X] T079 [US1] [simples] Exportar a API pública do núcleo — `src/core/index.ts`
- [X] T080 [US1] Contrato de IPC compartilhado, `Result` e validadores comuns e dos domínios `catalog`, `workspace`, `tasks` — `src/shared/ipc-contract.ts`, `src/main/ipc/result.ts`, `src/main/ipc/validate-common.ts`, `src/main/ipc/validate-catalog.ts`, `src/main/ipc/validate-workspace.ts`, `src/main/ipc/validate-tasks.ts`
- [X] T081 [US1] Registro dos canais por domínio e composição (com T080, passa T039) — `src/main/ipc/register-catalog.ts`, `src/main/ipc/register-workspace.ts`, `src/main/ipc/register-tasks.ts`, `src/main/ipc/register.ts`
- [X] T082 [US1] Ponte de terminal (passa T040) — `src/main/ipc/terminal-ports.ts`
- [X] T083 [US1] Preload (passa T041) — `src/preload/preload.ts`
- [X] T084 [US1] Instância única e janela segura (passa T043) — `src/main/single-instance.ts`, `src/main/window.ts`
- [X] T085 [US1] `main.ts` e `app-paths.ts`: instância única primeiro, `MELINNA_USER_DATA`, composição do núcleo com adaptadores, hospedeiro e IPC — `src/main/main.ts`, `src/main/app-paths.ts`
- [X] T086 [US1] Layout automático (passa T048) — `src/core/layout/types.ts`, `src/core/layout/auto.ts`
- [X] T087 [US1] Casca da interface e receptor de port (passa T042 e T049) — `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/components/TopBar.tsx`, `src/renderer/store/workspace-store.ts`, `src/renderer/terminal/port-receiver.ts`
- [X] T088 [US1] `NewTaskDialog` (passa T046) — `src/renderer/components/NewTaskDialog.tsx`
- [X] T089 [US1] `TerminalView` com addons fit, unicode11, webgl (fallback DOM) e web-links, scrollback de 10.000 linhas, descarte de `onData` na reprodução, `ack` e marcas (passa T047) — `src/renderer/components/TerminalView.tsx`
- [X] T090 [US1] `Panel`, `PanelHeader` e `Grid` automático (passa T050; com o restante da US1, passa T051 e T052) — `src/renderer/components/Panel/Panel.tsx`, `src/renderer/components/Panel/PanelHeader.tsx`, `src/renderer/components/Grid/Grid.tsx`

**Checkpoint**: US1 funcional e testável sozinha.

---

## Phase 4: User Story 2 — Fechar e reabrir sem perder nada (P1)

**Goal**: processos sobrevivem ao fechamento; scrollback persistido; reanexação sem lacuna.

**Independent Test**: 2 execuções falsas, fechar mantendo rodando, matar uma por fora, reabrir.

### Testes da US2 (escrever antes)

- [X] T091 [P] [US2] `SegmentStore`: nome por deslocamento; fechamento a 2 MB; com 4 segmentos, apaga o mais antigo antes de abrir o próximo e nunca há 5 arquivos; `meta.json` atômico; leitura a partir de deslocamento disponível e descartado (marca `discarded` + `ESC[0m`); separador; continuação a partir de `totalBytes` — `tests/unit/core/scrollback/segment-store.test.ts`
- [X] T092 [P] [US2] `ScrollbackWriter`: não bloqueia o produtor; fila acima de 4 MB descarta o mais antigo e registra `gap`; `ENOSPC` para a gravação, emite `persisting: false`, tenta a cada 30 s e grava marca de lacuna ao voltar; `flush` antes de leitura — `tests/unit/core/scrollback/scrollback-writer.test.ts`
- [X] T093 [P] [US2] `registry.json` do hospedeiro: gravação atômica em spawn e exit, leitura tolerante a arquivo ausente ou corrompido — `tests/unit/host/registry.test.ts`
- [X] T094 [P] [US2] Integração de reanexação: `attach` do zero recebe `replay-start`, histórico, `replay-end` e ao vivo com deslocamentos contíguos; consulta `query-cursor` feita durante a reprodução é respondida pelo hospedeiro; derrubar e reconectar o cliente e anexar do último deslocamento sem duplicar; processo que sai sem cliente fica no registro com código e horário; `list` reflete — `tests/integration/host/reattach.test.ts`
- [X] T095 [P] [US2] Integração de encerramento: `kill` envia Ctrl+C e o agente falso sai; com `ignore-sigint` e `spawn-child`, agente e neto encerrados à força após `graceMs`; `kill` de execução que não é do hospedeiro atual → `EXECUTION_NOT_RUNNING` sem tocar em pid algum; `shutdown` encerra todos, grava scrollback e sai — `tests/integration/host/kill.test.ts`
- [X] T096 [P] [US2] Integração de hospedeiro novo: após derrubar o hospedeiro, o novo não adota pids do registro anterior; relançar a execução continua os deslocamentos de `meta.json` sem sobrepor o histórico — `tests/integration/host/host-restart.test.ts`
- [X] T097 [P] [US2] Recuperação no núcleo: vivas no hospedeiro continuam `running`; com código → `exited`; ausentes sem saída → `lost`; `disconnected` marca vivas como `lost`; próximo lançamento pede hospedeiro novo — `tests/unit/core/execution/recovery.test.ts`
- [X] T098 [P] [US2] Fluxo de fechamento e IPC `app`: sem vivas fecha direto; com vivas emite `onCloseRequested`; `keep-running` mantém o hospedeiro; `stop-all` chama `stopAll(5000)`; `cancel` não fecha; validação de `answerClose` — `tests/unit/main/close-flow.test.ts`, `tests/unit/main/ipc/register-app.test.ts`
- [X] T099 [P] [US2] `CloseDialog` (padrão "Manter rodando", três opções) e `ScrollbackBanner` (disco cheio) — `tests/unit/renderer/CloseDialog.test.tsx`, `tests/unit/renderer/ScrollbackBanner.test.tsx`
- [X] T100 [P] [US2] `layout-store`: painéis abertos persistidos e reabertos com `terminal.open` na inicialização — `tests/unit/renderer/layout-store.test.ts`
- [X] T101 [P] [US2] Desempenho SC-004: reanexar 6 execuções com 8 MB de histórico cada em ≤ 2 s — `tests/perf/reattach.perf.test.ts`
- [X] T102 [P] [US2] E2E: lançar 2 execuções falsas, fechar com "Manter rodando", encerrar uma pelo pid, reabrir, ver histórico nos dois, eco na viva e código de saída na outra — `tests/e2e/close-and-reopen.spec.ts`

### Implementação da US2

- [X] T103 [US2] `SegmentStore` e `ScrollbackReader` (passa T091) — `src/core/scrollback/segment-store.ts`, `src/core/scrollback/scrollback-reader.ts`
- [X] T104 [US2] `ScrollbackWriter` (passa T092) — `src/core/scrollback/scrollback-writer.ts`
- [X] T105 [US2] Registro do hospedeiro (passa T093) — `src/host/registry.ts`
- [X] T106 [US2] Reprodução e anexação serializadas com `flush`, marcas `replay-start`/`replay-end`, responder ativo durante a reprodução, `detach`, `scrollback-status`, `list` (passa T094) — `src/host/attach.ts`, `src/host/server.ts`
- [X] T107 [US2] Encerramento: Ctrl+C, espera, `taskkill /T /F` ou sinais ao grupo; só processos do supervisor; `shutdown` (passa T095) — `src/host/kill-tree.ts`, `src/host/pty-supervisor.ts`
- [X] T108 [US2] Continuação de deslocamentos a partir de `meta.json` no spawn e não adoção de pids antigos (passa T096) — `src/host/pty-supervisor.ts`
- [X] T109 [US2] `reconcileWithHost`, `stopAll` e `disconnected` no núcleo, com ligação na fachada (passa T097) — `src/core/execution/recovery.ts`, `src/core/execution/execution-service.ts`
- [X] T110 [US2] Reinício do hospedeiro sob demanda após queda — `src/main/host-launcher.ts`
- [X] T111 [US2] Fluxo de fechamento, canais `app.onCloseRequested`/`answerClose` e `reconcileWithHost` na abertura (passa T098) — `src/main/close-flow.ts`, `src/main/ipc/register-app.ts`, `src/main/ipc/validate-app.ts`, `src/main/main.ts`
- [X] T112 [US2] `CloseDialog` e `ScrollbackBanner` (passa T099) — `src/renderer/components/CloseDialog.tsx`, `src/renderer/components/Panel/ScrollbackBanner.tsx`
- [X] T113 [US2] Persistir e reabrir painéis (passa T100; com o restante da US2, passa T101 e T102) — `src/renderer/store/layout-store.ts`, `src/renderer/App.tsx`

**Checkpoint**: US1 e US2 completas.

---

## Phase 5: User Story 3 — Árvore de grupos, tarefas e execuções (P2)

**Goal**: navegar e gerenciar o trabalho pela árvore.

**Independent Test**: dois grupos com execuções falsas; cada ação conferida em estado, processo e worktree.

### Testes da US3 (escrever antes)

- [ ] T114 [P] [US3] Integração de ciclo de vida com git real: parar mantém worktree e lease; relançar usa mesmo worktree, agente, modelo e modo, grava separador, incrementa `launchCount` e mantém o lease; remover viva → `EXECUTION_RUNNING`; `removalCheck` conta não commitados e commits fora da base; remover com trabalho e sem `force` → `WORK_WOULD_BE_LOST` sem remover nada; com `force` remove; sem trabalho remove com `branch -d`; `deleteBranch` falso mantém a branch; lease e scrollback removidos; árvore principal inalterada — `tests/integration/core/execution/lifecycle.test.ts`
- [ ] T115 [P] [US3] `WorkspaceService`: renomear grupo e tarefa com validação e persistência; `cleanResidue` recusa caminho fora da pasta de worktrees e caminho com lease válido, e remove resíduo válido — `tests/unit/core/workspace/rename-and-residue.test.ts`
- [ ] T116 [P] [US3] IPC: `executions.stop|relaunch|removalCheck|remove`, `workspace.renameGroup|renameTask|cleanResidue` com validação — `tests/unit/main/ipc/register-lifecycle.test.ts`, `tests/unit/main/ipc/register-workspace.test.ts`
- [ ] T117 [P] [US3] `Tree`: três níveis, estados com rótulo e faixa, ações conforme o estado, abrir foca painel existente, renomear inline — `tests/unit/renderer/Tree.test.tsx`
- [ ] T118 [P] [US3] `RemoveExecutionDialog` (mostra contagens de perda, exige confirmação explícita para forçar, escolha de manter a branch) e `ResidueDialog` (mostra o caminho, confirma e chama `cleanResidue`) — `tests/unit/renderer/RemoveExecutionDialog.test.tsx`, `tests/unit/renderer/ResidueDialog.test.tsx`

### Implementação da US3

- [ ] T119 [US3] `removalCheck` e remoção com e sem `force` (`worktree remove [--force]`, `branch -d|-D`, liberação do lease) — `src/core/git/removal.ts`
- [ ] T120 [US3] `stop`, `relaunch` e `remove` com ligação na fachada (com T119, passa T114) — `src/core/execution/lifecycle.ts`, `src/core/execution/execution-service.ts`
- [ ] T121 [US3] `renameGroup`, `renameTask` e `cleanResidue` (passa T115) — `src/core/workspace/workspace-service.ts`
- [ ] T122 [US3] Canais de ciclo de vida e de workspace (passa T116) — `src/main/ipc/register-lifecycle.ts`, `src/main/ipc/validate-lifecycle.ts`, `src/main/ipc/register-workspace.ts`, `src/main/ipc/validate-workspace.ts`, `src/main/ipc/register.ts`
- [ ] T123 [US3] Componentes da árvore (passa T117) — `src/renderer/components/Tree/Tree.tsx`, `src/renderer/components/Tree/TreeGroup.tsx`, `src/renderer/components/Tree/TreeTask.tsx`, `src/renderer/components/Tree/TreeExecution.tsx`
- [ ] T124 [US3] Diálogos de remoção e de resíduo (passa T118) — `src/renderer/components/RemoveExecutionDialog.tsx`, `src/renderer/components/ResidueDialog.tsx`

**Checkpoint**: US3 completa.

---

## Phase 6: User Story 4 — Comparar diffs (P2)

**Goal**: ver o que cada agente mudou, lado a lado ou unificado.

**Independent Test**: worktree com commit novo, stage, fora de stage, não rastreado, apagado, renomeado e binário.

### Testes da US4 (escrever antes)

- [ ] T125 [P] [US4] Parser de diff unificado (cabeçalhos, renomeação, novo, apagado, binário, sem nova linha no fim, caminhos com espaço e acentos) e montagem lado a lado — `tests/unit/core/git/diff-parse.test.ts`, `tests/unit/core/git/diff-side-by-side.test.ts`
- [ ] T126 [P] [US4] Integração do `DiffService` com os sete tipos de mudança, tamanhos de binário e índice do worktree inalterado — `tests/integration/core/git/diff.test.ts`
- [ ] T127 [P] [US4] Integração de divergência: base avança 3 commits criados com `git commit-tree` + `git update-ref` → `baseAdvancedBy: 3` por `rev-list --count`; base apagada → 0 com aviso no log — `tests/integration/core/git/divergence.test.ts`
- [ ] T128 [P] [US4] IPC `executions.diff` e `executions.divergence` com validação — `tests/unit/main/ipc/register-diff.test.ts`
- [ ] T129 [P] [US4] `DiffView` (alternar modos sem nova chamada, recolher acima de 5.000 linhas, binário com tamanhos, lista de arquivos) e selo "base avançou N commits" no `PanelHeader` e na `TreeExecution` — `tests/unit/renderer/DiffView.test.tsx`, `tests/unit/renderer/DivergenceBadge.test.tsx`

### Implementação da US4

- [ ] T130 [US4] Parser e lado a lado (passa T125) — `src/core/git/diff-parse.ts`, `src/core/git/diff-side-by-side.ts`
- [ ] T131 [US4] `DiffService` (passa T126) — `src/core/git/diff.ts`
- [ ] T132 [US4] Divergência e ligação na fachada (passa T127) — `src/core/git/divergence.ts`, `src/core/execution/execution-service.ts`
- [ ] T133 [US4] Canais de diff (passa T128) — `src/main/ipc/register-diff.ts`, `src/main/ipc/validate-diff.ts`, `src/main/ipc/register.ts`
- [ ] T134 [US4] `DiffView` (passa parte de T129) — `src/renderer/components/DiffView/DiffView.tsx`, `src/renderer/components/DiffView/FileList.tsx`, `src/renderer/components/DiffView/UnifiedView.tsx`, `src/renderer/components/DiffView/SideBySideView.tsx`
- [ ] T135 [US4] Selo de divergência (passa o restante de T129) — `src/renderer/components/DivergenceBadge.tsx`, `src/renderer/components/Panel/PanelHeader.tsx`, `src/renderer/components/Tree/TreeExecution.tsx`

**Checkpoint**: US4 completa.

---

## Phase 7: User Story 5 — Quatro layouts, redimensionar e reordenar (P3)

**Goal**: Automático, Spotlight, Sidebar e Grade personalizada, persistidos.

**Independent Test**: 4 painéis, alternar modos, arrastar divisórias e reordenar, reiniciar.

### Testes da US5 (escrever antes)

- [ ] T136 [P] [US5] `computeSpotlight` (faixa à direita em janela larga, embaixo em janela alta, foco inexistente cai no primeiro) e `computeSidebar` — `tests/unit/core/layout/spotlight.test.ts`, `tests/unit/core/layout/sidebar.test.ts`
- [ ] T137 [P] [US5] `computeCustom`, `moveDivider` (frações somam 1, mínimo, índice inválido) e `reorder` — `tests/unit/core/layout/custom.test.ts`, `tests/unit/core/layout/reorder.test.ts`
- [X] T138 [P] [US5] IPC `layout.get|set` com validação do `LayoutState` e persistência em `state.json` — `tests/unit/main/ipc/register-layout.test.ts`
- [ ] T139 [P] [US5] `Grid` nos quatro modos: troca reposiciona e reenvia tamanho dos visíveis; persistência via `layout.set` — `tests/unit/renderer/Grid-modes.test.tsx`
- [ ] T140 [P] [US5] `Divider` (arrasto altera proporções ao vivo e salva ao soltar), reordenação por arrastar o cabeçalho, `LayoutSwitcher` e atalhos `Ctrl+Alt+→`/`←` no Spotlight — `tests/unit/renderer/Divider.test.tsx`, `tests/unit/renderer/LayoutSwitcher.test.tsx`

### Implementação da US5

- [ ] T141 [US5] Spotlight e sidebar (passa T136) — `src/core/layout/spotlight.ts`, `src/core/layout/sidebar.ts`
- [ ] T142 [US5] Grade personalizada e reordenação (passa T137) — `src/core/layout/custom.ts`, `src/core/layout/reorder.ts`
- [X] T143 [US5] Canais de layout (passa T138) — `src/main/ipc/register-layout.ts`, `src/main/ipc/validate-layout.ts`, `src/main/ipc/register.ts`
- [ ] T144 [US5] Modos na `Grid` (passa T139) — `src/renderer/components/Grid/Grid.tsx`, `src/renderer/store/layout-store.ts`
- [ ] T145 [US5] `Divider`, reordenação no cabeçalho, `LayoutSwitcher` e atalhos (passa T140) — `src/renderer/components/Grid/Divider.tsx`, `src/renderer/components/Grid/useReorderDrag.ts`, `src/renderer/components/LayoutSwitcher.tsx`

**Checkpoint**: US5 completa.

---

## Phase 8: User Story 6 — Modelo e modo de permissão por painel (P3)

**Goal**: escolher e trocar modelo e modo, conforme a capacidade do agente.

**Independent Test**: `fake` (troca por comando), `fake-resume` e `fake-nosw`.

### Testes da US6 (escrever antes)

- [ ] T146 [P] [US6] `BusyTracker`: ocupado até 1,5 s após a última atividade; encerrada nunca ocupada — `tests/unit/core/execution/busy-tracker.test.ts`
- [ ] T147 [P] [US6] `switch-planner` para modelo e para modo de permissão: cada estratégia gera o plano certo; `pty-command` ocupado → `waitsForIdle`; relançamentos marcam `interruptsResponse` se ocupado; modo `dangerous` exige confirmação; valor fora da lista sem `allowCustom` → `INPUT_INVALID`; shell → `SWITCH_UNSUPPORTED` — `tests/unit/core/execution/switch-planner.test.ts`
- [ ] T148 [P] [US6] Integração da troca de modelo: `fake` ocioso recebe `/model X`; em `/busy 3000` só recebe após ocioso; cancelar a pendente não escreve nada; `fake-resume` relança com `resume.args` e novo modelo; `fake-nosw` relança sem retomada com separador — `tests/integration/core/execution/switch-model.test.ts`
- [ ] T149 [P] [US6] Integração da troca de modo de permissão (caso de borda 12) nas três estratégias: `fake` recebe `/permission X`; `fake-resume` relança com os argumentos do novo modo e `resume.args`; `fake-nosw` relança sem retomada; o estado reflete o modo novo — `tests/integration/core/execution/switch-permission.test.ts`
- [ ] T150 [P] [US6] IPC `executions.requestSwitch|confirmSwitch|cancelPendingSwitch` com validação — `tests/unit/main/ipc/register-switch.test.ts`
- [ ] T151 [P] [US6] `ModelSelect` e `PermissionSelect`: valores do catálogo, campo personalizado validado, "trocar ao ficar ocioso" com cancelar, diálogos de relançamento e de perda de conversa, confirmação de modo perigoso com texto sobre isolamento só de arquivos — `tests/unit/renderer/ModelSelect.test.tsx`, `tests/unit/renderer/PermissionSelect.test.tsx`
- [ ] T152 [P] [US6] Escolha de modelo e modo por agente no `NewTaskDialog`, com confirmação de modo perigoso — `tests/unit/renderer/NewTaskDialog-picks.test.tsx`

### Implementação da US6

- [ ] T153 [US6] `BusyTracker` alimentado por `activity` (passa T146) — `src/core/execution/busy-tracker.ts`
- [ ] T154 [US6] `switch-planner` (passa T147) — `src/core/execution/switch-planner.ts`
- [ ] T155 [US6] `SwitchService` com `pendingSwitch` persistido e ligação na fachada (passa T148 e T149) — `src/core/execution/switch-service.ts`, `src/core/execution/execution-service.ts`
- [ ] T156 [US6] Canais de troca (passa T150) — `src/main/ipc/register-switch.ts`, `src/main/ipc/validate-switch.ts`, `src/main/ipc/register.ts`
- [ ] T157 [US6] `ModelSelect`, `PermissionSelect` e `ConfirmDialog` no cabeçalho do painel (passa T151) — `src/renderer/components/ModelSelect.tsx`, `src/renderer/components/PermissionSelect.tsx`, `src/renderer/components/ConfirmDialog.tsx`, `src/renderer/components/Panel/PanelHeader.tsx`
- [ ] T158 [US6] Escolha por agente no `NewTaskDialog` (passa T152) — `src/renderer/components/NewTaskDialog.tsx`

**Checkpoint**: todas as histórias completas.

---

## Phase 9: Polish & Cross-Cutting

### Testes do Polish (escrever antes)

- [ ] T159 [P] Busca no terminal: `Ctrl+Shift+F` abre no painel em foco, próximo/anterior, `Esc` fecha — `tests/unit/renderer/TerminalSearch.test.tsx`
- [ ] T160 [P] `openExternal` aceita só `http`/`https` e recusa `file:`, `javascript:` e URLs malformadas; canal `app.openExternal` — `tests/unit/main/open-external.test.ts`
- [ ] T161 [P] Tela de catálogo: agentes, estado de instalação e inválidos com motivo — `tests/unit/renderer/CatalogView.test.tsx`

### Implementação do Polish

- [ ] T162 Busca no terminal com `@xterm/addon-search` (passa T159) — `src/renderer/components/Panel/TerminalSearch.tsx`, `src/renderer/components/TerminalView.tsx`
- [ ] T163 `openExternal` ligado ao addon web-links (passa T160) — `src/main/open-external.ts`, `src/main/ipc/register-app.ts`, `src/main/ipc/validate-app.ts`
- [ ] T164 Tela de catálogo (passa T161) — `src/renderer/components/CatalogView.tsx`
- [ ] T165 [simples] `README.md` (o que é, pré-requisitos, comandos, regra de independência de código e de marca em relação à referência de inspiração) — `README.md`

---

## Dependencies & Execution Order

As histórias são **sequenciais** (US1 → US2 → US3 → US4 → US5 → US6 → Polish), porque compartilham a fachada `execution-service.ts`, `register.ts`, `PanelHeader.tsx`, `NewTaskDialog.tsx` e `workspace-service.ts`. Dentro de cada fase, as tasks `[P]` podem correr em paralelo.

### Setup e fundação

- T001 primeiro; T002–T008 em paralelo depois.
- T009 independe das demais da fundação.
- T011 antes de T014. T012 e T013 antes de T014, T015, T016, T019 e T020.
- T016 antes de T017. T019 antes de T022.
- T010, T018, T021, T023 e T024 sem dependência interna.

### Dentro das histórias

- Todos os testes da história antes da implementação da história.
- US1: T053 → T054 → T055 → T056; T057 → T058 → T059 → T060 (mesmo arquivo); T061–T064 antes de T065; T067 → T068 → T069 → T070 → T071 → T072; T072 antes de T073 e T074; T075, T076 e T077 antes de T078; T078 antes de T079; T079 antes de T080–T085; T080 antes de T081; T083 antes de T084 e T085; T085 antes de T087; T086 antes de T090.
- US2: T103 → T104 → T106; T105 antes de T106; T106 → T107 → T108 (mesmo supervisor); T109 depois de T108; T110 depois de T109; T111 depois de T110.
- US3: T119 antes de T120; T120 e T121 antes de T122.
- US4: T130 antes de T131; T131 e T132 antes de T133.
- US5: T141 e T142 antes de T144; T143 antes de T144; T144 antes de T145.
- US6: T153 e T154 antes de T155; T155 antes de T156; T156 antes de T157 e T158.

## Implementation Strategy

1. Setup + Fundação.
2. US1 → MVP (lançar e conversar).
3. US2 → fechar e reabrir (completa o P1).
4. US3 e US4 (P2), depois US5 e US6 (P3).
5. Polish.

## Contagem

| Fase | Tasks |
|------|-------|
| 1 Setup | 8 |
| 2 Fundação | 16 |
| 3 US1 (P1) | 66 (28 testes + 38 implementação) |
| 4 US2 (P1) | 23 (12 + 11) |
| 5 US3 (P2) | 11 (5 + 6) |
| 6 US4 (P2) | 11 (5 + 6) |
| 7 US5 (P3) | 10 (5 + 5) |
| 8 US6 (P3) | 13 (7 + 6) |
| 9 Polish | 7 (3 + 4) |
| **Total** | **165** |
