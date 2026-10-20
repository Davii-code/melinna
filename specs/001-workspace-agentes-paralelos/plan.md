# Implementation Plan: Workspace de agentes paralelos (primeira fatia)

**Branch**: `001-workspace-agentes-paralelos` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-workspace-agentes-paralelos/spec.md`

## Summary

App Electron em TypeScript com três processos de código próprio: a **interface** (renderer React com xterm.js), o **principal** (Electron main, que orquestra pelo núcleo) e o **hospedeiro de PTY** (processo Node destacado, dono dos PTYs via node-pty e do scrollback em disco). A orquestração vive em `src/core`, sem dependência de Electron, node-pty ou React, protegida por um teste de arquitetura. Worktrees e branches são criados com `git` via `execFile`, sempre fora da árvore do usuário. O hospedeiro sobrevive ao fechamento da janela e aceita reconexão autenticada por segredo local, o que dá reanexação com scrollback emendado por deslocamento de bytes.

## Technical Context

**Language/Version**: TypeScript 5.x em modo `strict`; Electron 44.x, que embute Node 24 (o Node dos testes de integração e do hospedeiro é o do Electron).

**Primary Dependencies** (lista fechada; qualquer acréscimo exige aprovação, Princípio VII). Linha de versão fixada aqui; T001 grava a versão exata mais recente dessa linha no `package.json`, sem `^` nem `~`:

| Pacote | Linha | Uso | Tipo |
|--------|-------|-----|------|
| `electron` | 44.x | camada de desktop | dev (empacotado) |
| `node-pty` | 1.1.x (estável; não usar as betas 1.2) | PTY / ConPTY no hospedeiro | runtime, nativo |
| `@xterm/xterm` | 6.x | emulador de terminal | runtime |
| `@xterm/addon-fit`, `@xterm/addon-search`, `@xterm/addon-webgl`, `@xterm/addon-unicode11`, `@xterm/addon-web-links` | versões compatíveis com xterm 6 | ajuste, busca, desempenho, largura Unicode, links | runtime |
| `react`, `react-dom` | 19.x | interface | runtime |
| `@types/node` | 24.x (igual ao Node do Electron 44) | tipos | dev |
| `@types/react`, `@types/react-dom` | 19.x | tipos | dev |
| `typescript` | 5.x | compilador; também usado pelo teste de arquitetura para ler imports | dev |
| `electron-vite`, `vite`, `@vitejs/plugin-react` | build de main, preload, host e renderer | dev |
| `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event` | testes unitários e de componentes | dev |
| `@playwright/test` | testes ponta a ponta do app Electron | dev |
| `@electron/rebuild` | recompilar node-pty para o ABI do Electron | dev |
| `electron-builder` | empacotamento (instalador não assinado nesta fatia) | dev |
| `eslint`, `typescript-eslint`, `prettier` | lint e formatação | dev |

Sem biblioteca de estado, de validação de esquema, de diff, de layout ou de arrastar e soltar: essas partes são código próprio pequeno e testado, para não ampliar a superfície de dependências.

**Storage**: arquivos no diretório de dados do app (`app.getPath('userData')`, repassado ao núcleo e ao hospedeiro como caminho): `state.json` (workspace e layout), `host/registry.json` (processos), `scrollback/<execId>/*.seg`, `worktrees/<repoId>/<execId>/`, `logs/*.log`, `catalog.json` (opcional, do usuário). Gravação atômica para JSON.

**Testing**: Vitest (projetos `unit`, `integration`, `arch`, `perf`), Playwright para Electron (projeto `e2e`). Os projetos `integration` e `perf` usam `pool: 'forks'`, porque o node-pty não deve ser carregado em worker threads.

**Fuse do Electron**: o hospedeiro depende de `ELECTRON_RUN_AS_NODE`. O fuse `RunAsNode` deve permanecer ligado no binário empacotado (configuração `electronFuses` do electron-builder, com `runAsNode: true` explícito), e a dependência fica registrada aqui para que nenhum endurecimento futuro o desligue sem trocar o modo de iniciar o hospedeiro.

**Target Platform**: Windows 10 1809+ (validado); macOS 13+ e Linux x64 compilam no CI.

**Project Type**: desktop-app.

**Performance Goals**: SC-001 (6 lançamentos em ≤ 6 s num repositório de 1.000 arquivos), SC-002 (≤ 30 ms p95 de latência adicional), SC-004 (reanexação em ≤ 2 s). SC-001, SC-002 (trecho hospedeiro ↔ principal) e SC-004 têm testes no projeto `perf`; SC-002 na pintura e SC-008 (memória) são validados pelo dono pelo quickstart.

**Constraints**: nunca escrever na árvore principal; sem shell no lançamento; 12 execuções no máximo; 8 MB de scrollback por execução; app ≤ 800 MB com 12 execuções.

**Scale/Scope**: 1 usuário local, até 12 PTYs vivos, dezenas de tarefas.

## Constitution Check

| Princípio | Como o plan atende | Status |
|-----------|--------------------|--------|
| I. Agente é processo | Catálogo JSON com esquema próprio (`contracts/catalog-schema.md`); o motor só interpreta capacidades declaradas | OK |
| II. Isolamento por worktree | Worktrees em `userData/worktrees`; leituras com `--no-optional-locks`; teste de integração de invariância da árvore principal em todo fluxo de git | OK |
| III. PTY é a verdade | Hospedeiro de PTY destacado, dono do PTY e do scrollback; interface só anexa | OK |
| IV. Núcleo independente | `src/core` sem Electron, node-pty, React; teste `tests/arch/boundaries.test.ts` | OK |
| V. Testes | Seção de testes por história escrita antes da implementação; estratégia abaixo | OK |
| VI. Entregável completo | Erros tipados com mensagem ao usuário; casos de borda com task própria | OK |
| VII. Sem surpresas | Dependências fechadas acima; contratos em `contracts/` | OK |
| VIII. Execução segura | Seção Segurança | OK |
| IX. Independência da referência | Nenhuma task lê o repositório de referência; nomes próprios em todo o código | OK |
| X. Identidade visual | Tokens de tema derivados da spec; assets de `docs/brand/` | OK |

## Arquitetura

```text
┌──────────────── renderer (React + xterm.js) ────────────────┐
│ Tree · Grid · Panel · TerminalView · NewTaskDialog · Diff   │
└──────────── window.melinna (preload, contextBridge) ────────┘
                 │ IPC tipado (contracts/ipc.md)
┌──────────────── main (Electron) ────────────────────────────┐
│ adaptadores Electron → src/core (WorkspaceService,           │
│ ExecutionService, CatalogService, DiffService, Layout)       │
│ HostClient ──────── pipe nomeado / socket local ─────┐       │
└──────────────────────────────────────────────────────┼───────┘
┌──────────────── host (Node destacado) ────────────────┴──────┐
│ HostServer · PtySupervisor(node-pty) · ScrollbackWriter      │
│ (usa src/core/scrollback e src/core/contracts)               │
└──────────────────────────────────────────────────────────────┘
```

- O **hospedeiro** é iniciado pelo principal com `process.execPath` e `ELECTRON_RUN_AS_NODE=1`, destacado (`detached: true`, stdio ignorado, `unref()`), rodando `out/host/main.js`. Assim o node-pty compilado para o ABI do Electron serve aos dois processos, sem segunda compilação. Se já houver um hospedeiro vivo, o principal se conecta a ele.
- O **principal** é o único que fala com git e com o estado do workspace. O hospedeiro só sabe de processos e bytes.
- A **interface** nunca tem Node habilitado (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`). Recebe saída de PTY por `MessagePort` dedicado por painel, para não serializar bytes pelo canal geral. Como o `contextBridge` não transfere `MessagePort` como valor de retorno, o port é entregue por `webContents.postMessage` e repassado pelo preload com `window.postMessage` (sequência em `contracts/ipc.md`, "Entrega do port do terminal").
- **Instância única**: o principal chama `app.requestSingleInstanceLock()` antes de qualquer outra inicialização; uma segunda instância só foca a janela existente e sai. Isso garante um único dono de `state.json` e dos leases.
- **Registro de IPC por domínio**: cada domínio tem seu arquivo (`ipc/register-catalog.ts`, `register-workspace.ts`, `register-tasks.ts`, `register-lifecycle.ts`, `register-diff.ts`, `register-switch.ts`, `register-layout.ts`, `register-app.ts`) com o validador correspondente (`ipc/validate-<domínio>.ts`) e teste próprio; `ipc/register.ts` só compõe. Assim histórias diferentes não editam o mesmo arquivo.

### Controle de fluxo

Saída massiva não pode estourar memória nem latência. O hospedeiro pausa o PTY (`pty.pause()`) quando a conexão anexada tem mais de 1 MB sem confirmação e retoma abaixo de 256 KB; a página confirma (`ack`) a cada 256 KB que o xterm processou (callback de `term.write`), e o principal repassa o `ack`. Sem conexão anexada, o PTY nunca é pausado. Detalhes em `contracts/host-protocol.md`.

### Consultas do terminal

Agentes e o ConPTY enviam consultas (DA, DSR, CPR, OSC de cor) e esperam resposta; sem resposta, alguns travam. Com painel anexado, o xterm da interface responde. Sem painel anexado (painel fechado ou app fechado) e durante a reprodução do scrollback, o hospedeiro responde com o `TerminalQueryResponder` (`src/host/query-responder.ts`), conforme a tabela de `contracts/host-protocol.md`. Durante a reprodução, a página descarta o que o xterm gerar em `onData`, para que respostas a consultas antigas não cheguem ao PTY. A posição de cursor respondida sem painel é aproximada; um emulador sem cabeça exato (`@xterm/headless`) exige aprovação de dependência e fica como pendência.

### Ciclo de vida do WorktreeLease

- **Adquirir** no preparo da execução, antes do `git worktree add`, com `flag: 'wx'`. O conteúdo registra `execId` e o pid do principal.
- **Manter** em parar e relançar: o lease pertence à execução, não ao processo. Relançar verifica que o lease existente é da mesma execução e prossegue.
- **Validar ao iniciar o app**: lease cujo `execId` não existe em `state.json` é resíduo; lease de execução conhecida continua válido, independentemente do pid gravado (a instância única garante que não há outro principal).
- **Liberar** na remoção, depois do `git worktree remove`, e no desfazer de um preparo que falhou.

### Concorrência de git

Operações que escrevem em `.git` de um mesmo repositório (`worktree add`, `worktree remove`, `worktree prune`, `branch -D`) passam por um mutex por `repoId` (`src/core/git/repo-mutex.ts`), porque o git concorrente disputa `.git/worktrees` e `packed-refs`. O lançamento de seis execuções prepara os worktrees em série e inicia cada processo assim que o seu worktree fica pronto, sem esperar os demais.

### Fluxo de lançamento

1. Interface chama `workspace.inspectRepo`, mostra o aviso de alterações não commitadas, se houver, e depois `tasks.createAndLaunch(input)`.
2. `WorkspaceService.createTask` valida repositório e ponto de partida (`git rev-parse --verify <ref>^{commit}`).
3. `ExecutionService.prepare` para cada agente, em série sob o mutex do repositório: verifica limite, resolve lançamento pelo catálogo, gera nome de branch livre, adquire `WorktreeLease`, roda `git worktree add -b <branch> <path> <commit>`; em falha, desfaz só aquela execução. O worktree de cada execução existe antes do seu processo.
4. `ExecutionService.start` de cada execução assim que o seu preparo termina: envia `spawn` ao hospedeiro com `file`, `args`, `cwd`, `env`, `cols`, `rows`; o hospedeiro grava o registro e passa a gravar scrollback.
5. Se o enunciado é entregue por PTY, o principal escreve-o após o primeiro evento de saída da execução.

### Reanexação

O hospedeiro numera cada byte de saída por execução (deslocamento acumulado desde o início). `attach(execId, fromOffset)` faz o hospedeiro esvaziar o buffer pendente para o disco, enviar os segmentos a partir de `fromOffset` (ou do primeiro disponível, com marca de descarte) e emendar a saída ao vivo a partir do deslocamento seguinte. Como o hospedeiro é o único escritor e serializa essas operações por execução, não há lacuna nem duplicação. A reprodução é delimitada por marcas `replay-start`/`replay-end`.

Um hospedeiro novo (após queda) nunca adota pids do `registry.json` anterior, porque o Windows reaproveita pids: as execuções que não estão vivas no hospedeiro atual ficam `lost`. No relançamento, o hospedeiro continua os deslocamentos a partir do `totalBytes` de `meta.json`, então o histórico antigo e o novo não se sobrepõem.

## Contratos públicos entre camadas

Detalhados em `contracts/`:

- [`contracts/core-api.md`](./contracts/core-api.md) — serviços e portas do núcleo (o que principal, futuro daemon e futura CLI consomem).
- [`contracts/host-protocol.md`](./contracts/host-protocol.md) — protocolo binário entre principal e hospedeiro.
- [`contracts/ipc.md`](./contracts/ipc.md) — API `window.melinna` exposta pelo preload à interface.
- [`contracts/catalog-schema.md`](./contracts/catalog-schema.md) — esquema do catálogo de agentes, versão 1.
- [`data-model.md`](./data-model.md) — entidades, estados e formatos em disco.

Todos têm campo de versão (`protocolVersion`, `schemaVersion`); mudança incompatível exige aprovação e incremento.

## Tratamento de erro

- O núcleo lança `MelinnaError` (`src/core/errors.ts`) com `code` (união de strings fechada), `userMessage` em pt-BR, `details` sem conteúdo sensível e `cause`. Códigos: `CATALOG_INVALID`, `AGENT_NOT_FOUND`, `EXECUTABLE_NOT_FOUND`, `UNSAFE_LAUNCHER`, `PROMPT_INVALID`, `REPO_INVALID`, `BASE_REF_NOT_FOUND`, `BRANCH_INVALID`, `WORKTREE_IN_USE`, `WORKTREE_RESIDUE`, `GIT_FAILED`, `LIMIT_REACHED`, `EXECUTION_RUNNING`, `EXECUTION_NOT_RUNNING`, `WORK_WOULD_BE_LOST`, `HOST_UNAVAILABLE`, `HOST_PROTOCOL`, `HOST_AUTH`, `HOST_VERSION`, `INPUT_INVALID`, `DISK_FULL`, `STATE_CORRUPT`, `SWITCH_UNSUPPORTED`, `INTERNAL`. `INPUT_INVALID` cobre payload de IPC fora do contrato, modelo personalizado inválido e modo fora da lista; `INTERNAL` só é criado por `toIpcError`.
- Erros que não são `MelinnaError` são embrulhados como `INTERNAL` no limite do IPC, com mensagem genérica para o usuário e detalhe só no log.
- O IPC nunca rejeita promessa com objeto `Error`: devolve `{ ok: true, value } | { ok: false, error: { code, message } }`.
- Falhas parciais (uma execução de seis) não abortam as outras: cada execução tem resultado próprio.
- `state.json` corrompido: renomeado para `state.corrupt-<data>.json`, app abre com workspace vazio e avisa; nunca sobrescreve sem guardar o anterior.
- Falha de disco no scrollback: caso de borda 11; nunca propaga para o PTY.

## Logs

- Logger próprio (`src/core/log/logger.ts`, porta `Logger`) gravando JSON Lines em `logs/main.log` e `logs/host.log`, rotação a 5 MB, 3 arquivos.
- Campos: `ts`, `level` (`debug|info|warn|error`), `component`, `event`, `execId?`, `taskId?`, `code?`, `durationMs?`, `err?` (nome, mensagem, pilha).
- Nunca registrar: bytes de PTY, enunciado, entrada digitada, variáveis de ambiente, argumentos derivados do enunciado. Registrar no lugar: tamanhos e contagens.
- Eventos mínimos: lançamento (agente, modelo, modo), saída de processo (código, sinal, duração), criação e remoção de worktree, falha de git (comando sem argumentos de usuário, código, stderr truncado a 2 KB), conexão e queda do hospedeiro, disco cheio e retomada, troca de modelo e de modo (estratégia aplicada).

## Segurança

**Construção da linha de comando sem shell.** O app lança processos com argumentos que vêm do catálogo e do texto do usuário. Por isso:

- O lançamento sempre usa `file` + `args: string[]` (node-pty `spawn`, `child_process.execFile`). Nunca `shell: true`, `exec`, `cmd /c`, `sh -c`, nem concatenação de string de comando.
- O executável é resolvido para caminho absoluto pelo núcleo (`resolveExecutable`, PATH + PATHEXT no Windows) antes do lançamento. Defesa em profundidade: o hospedeiro também recusa `file` relativo e `file` terminado em `.cmd` ou `.bat` (sem diferenciar maiúsculas), mesmo que o principal tenha validado.
- **Serialização no Windows**: o ConPTY recebe uma única linha de comando, então o node-pty junta `file` e `args` com as regras de aspas do `CommandLineToArgvW`. Não há shell nesse caminho (o processo é criado direto, sem `cmd.exe`), mas a fidelidade dos argumentos depende dessa serialização. Por isso o teste de integração de lançamento envia enunciados adversariais (aspas, `\"`, barras invertidas no fim, `%PATH%`, `&`, `|`, `^`, `<`, `>`, quebra de linha, tabulação, emoji e CJK) e confere que chegam íntegros no JSON de argumentos do agente falso, que é um processo `node` (mesma regra de parse).
- **Windows e `.cmd`/`.bat`:** como o Windows passa esses arquivos por `cmd.exe`, que reinterpreta metacaracteres, o motor nunca lança `.cmd`/`.bat` quando há argumento derivado do usuário (enunciado, modelo personalizado). A entrada do catálogo declara `windows.npmShim { package, bin }`; o resolvedor localiza `<pasta-do-shim>/node_modules/<package>/package.json`, lê o campo `bin` e lança `node <script>` (node encontrado no PATH) ou o `.exe` nativo, se existir. Sem resolução segura: erro `UNSAFE_LAUNCHER`.
- Placeholders do catálogo (`{model}`, `{prompt}`) só substituem um argumento inteiro, nunca parte dele, e nunca viram vários argumentos.
- Valores validados: modelo personalizado `^[A-Za-z0-9._:/@-]{1,100}$`; modo de permissão só da lista do catálogo; enunciado sem `\0`; se o comprimento total da linha passar de 30.000 caracteres no Windows (limite de 32.767), o enunciado é entregue pelo PTY.
- `git` é chamado só por `execFile('git', args)`, com `--` antes de caminhos, nomes de branch validados por `git check-ref-format --branch` e refs do usuário verificadas com `rev-parse --verify` antes de qualquer uso.
- **Encerramento**: gracioso = escrever `\x03` (Ctrl+C) no PTY e aguardar `graceMs` (padrão 5.000). Forçado, se o processo não saiu: no Windows `execFile('taskkill', ['/PID', String(pid), '/T', '/F'])`; no POSIX `SIGTERM` ao grupo do processo e `SIGKILL` após 1 s. O hospedeiro só encerra pids de processos que ele mesmo criou e que ainda estão no seu `PtySupervisor`; nunca pids lidos do `registry.json`, porque o sistema pode tê-los reaproveitado.

**Hospedeiro de PTY.** Escuta só em pipe nomeado local (`\\.\pipe\melinna-desk-<hash do usuário>`) ou socket Unix em diretório `0700`. Exige `hello` com segredo de 32 bytes aleatórios, gravado em `userData/host/token` (no POSIX, `0600`), comparado em tempo constante; conexão sem `hello` válido em 2 s é fechada. Rejeita quadros acima de 1 MB e mensagens fora do esquema.

**Interface.** `sandbox`, `contextIsolation`, sem `nodeIntegration`, CSP restrita (`default-src 'self'`), sem `remote`, navegação externa bloqueada; links do terminal só abrem por `shell.openExternal` após clique e só com esquema `http`/`https`. O preload expõe só a API tipada de `contracts/ipc.md`, e o principal valida todo payload recebido.

**Remoção sem perda silenciosa.** Antes de remover, o núcleo conta arquivos não commitados no worktree e commits da branch ausentes da base (`removalCheck`). Com trabalho a perder, `remove` sem `force` falha com `WORK_WOULD_BE_LOST`; a interface mostra as contagens e só então oferece forçar (`git worktree remove --force`, `git branch -D`). Sem trabalho a perder, usa `git worktree remove` e `git branch -d`.

**Modos perigosos.** Modos marcados `dangerous` no catálogo (por exemplo, sem confirmações) exigem confirmação explícita a cada lançamento ou troca. O worktree isola arquivos do repositório, não a máquina: o aviso diz isso.

**Ambiente.** O processo do agente herda o ambiente do usuário mais `TERM`, `COLORTERM` e `MELINNA_EXECUTION_ID`; nenhum segredo é injetado pelo app.

## Estratégia de testes

**Unitários** (`tests/unit`, Vitest, ambiente Node ou jsdom; sem processo real, sem git real, com portas falsas):

- catálogo: validação, mesclagem embutido + usuário, substituição de placeholders, resolução de lançamento e de shim npm (sistema de arquivos falso), detecção;
- nomes: slug, nome de branch, sufixo em colisão;
- máquina de estados da execução; limite de 12; `BusyTracker`; decisão de troca de modelo/modo;
- scrollback: rotação de segmentos, leitura a partir de deslocamento, marcas de descarte e lacuna, disco cheio (fs falso que lança `ENOSPC`);
- gravação atômica e migração de esquema do estado;
- algoritmos de layout (automático, spotlight, sidebar, personalizada, reordenação) como funções puras;
- parser de diff unificado e montagem lado a lado;
- codificação e decodificação de quadros do protocolo do hospedeiro;
- componentes React (jsdom): árvore, cabeçalho do painel, seletores, diálogo de nova tarefa, diff, diálogos de confirmação.

**Integração** (`tests/integration`, Vitest em Node do Electron via `scripts/vitest-electron-node.mjs`, que roda o Vitest com `ELECTRON_RUN_AS_NODE=1` para carregar o node-pty do ABI do Electron):

- git real em repositórios temporários: criação e remoção de worktree, colisão de branch, resíduo, alterações não commitadas, avanço da base, diff com commit, stage, não rastreado, apagado e binário;
- **invariância da árvore principal**: utilitário que captura HEAD, branch, hash do índice e hash de todos os arquivos, aplicado antes e depois de cada teste de git;
- hospedeiro real com `tests/fixtures/fake-agent.mjs` (agente controlado: ecoa entrada, emite cores, reporta tamanho do terminal, aceita `/model X`, sai com código pedido): spawn, escrita, resize, saída, kill da árvore, attach com deslocamento, reconexão após derrubar o cliente, hospedeiro sem token;
- fluxo `ExecutionService` completo com hospedeiro real e git real.

**Arquitetura** (`tests/arch/boundaries.test.ts`): lê imports com a API do compilador TypeScript e reprova `src/core/**` importando `electron`, `node-pty`, `react`, `@xterm/*` ou qualquer arquivo de `src/main`, `src/preload`, `src/renderer`, `src/host`; reprova `src/host/**` e `src/adapters/**` importando `electron`; reprova `src/renderer/**` importando módulos Node, `src/main` ou `src/core` (exceto `src/core/layout`, que é puro).

Também na integração: consulta `ESC[6n` do agente falso respondida pelo hospedeiro sem painel anexado (o agente não trava); pausa e retomada do PTY por controle de fluxo com saída de 20 MB; enunciados adversariais íntegros; logs gravados durante lançamento e conversa não contêm o enunciado nem os bytes digitados.

**Desempenho** (`tests/perf`, mesmo executor da integração, `pool: 'forks'`): SC-001 (6 execuções do agente falso num repositório gerado de 1.000 arquivos, clique até o 6º `spawn` em ≤ 6 s), SC-002 no trecho principal ↔ hospedeiro (p95 do eco de 1.000 teclas ≤ 30 ms) e SC-004 (reanexar 6 execuções com 8 MB de histórico cada em ≤ 2 s). A latência de pintura e o SC-008 (memória) são verificados pelo dono, conforme o quickstart.

**Ponta a ponta** (`tests/e2e`, Playwright `_electron`): lançar tarefa com 2 agentes falsos e conversar; fechar mantendo rodando e reabrir com reanexação. Usam um catálogo de usuário apontando para o agente falso.

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-agentes-paralelos/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api.md
│   ├── host-protocol.md
│   ├── ipc.md
│   └── catalog-schema.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json · tsconfig.json · tsconfig.node.json · tsconfig.web.json
electron.vite.config.ts · vitest.config.ts · playwright.config.ts
electron-builder.yml · eslint.config.js · .prettierrc
catalog/agents.json                     # catálogo embutido
scripts/vitest-electron-node.mjs        # roda Vitest sob o Node do Electron
build/icons/                            # gerados a partir de docs/brand/logo.svg

src/core/                               # sem Electron, node-pty, React
├── index.ts                            # API pública do núcleo
├── errors.ts
├── ids.ts
├── ports/                              # Logger, Clock, FileSystem, ProcessRunner, HostClient
├── log/logger.ts · log/jsonl-sink.ts
├── persistence/atomic-file.ts · state-store.ts · state-schema.ts
├── catalog/schema.ts · validate.ts · load.ts · placeholders.ts
│           resolve-executable.ts · npm-shim.ts · launch-plan.ts · detect.ts
├── git/git-runner.ts · repo.ts · repo-mutex.ts · branch-name.ts · worktree.ts · lease.ts
│       residue.ts · removal.ts · divergence.ts · diff.ts · diff-parse.ts · diff-side-by-side.ts
├── workspace/workspace-service.ts · workspace-model.ts
├── execution/execution-service.ts (fachada) · prepare.ts · start.ts · prompt-delivery.ts
│             recovery.ts · lifecycle.ts · state-machine.ts · limits.ts
│             busy-tracker.ts · switch-planner.ts · switch-service.ts
├── scrollback/segment-store.ts · scrollback-writer.ts · scrollback-reader.ts
├── layout/auto.ts · spotlight.ts · sidebar.ts · custom.ts · reorder.ts · types.ts
└── contracts/host-protocol.ts · frame-codec.ts

src/adapters/                           # implementações Node das portas (fs, execFile, plataforma, relógio); sem Electron
├── node-fs.ts · node-process-runner.ts · node-platform.ts · node-clock.ts

src/host/                               # processo hospedeiro (Node), pode usar node-pty
├── main.ts · server.ts · auth.ts · registry.ts · idle-exit.ts
├── pty-supervisor.ts · node-pty-adapter.ts · kill-tree.ts
├── flow-control.ts · query-responder.ts · attach.ts

src/main/                               # Electron main
├── main.ts · window.ts · single-instance.ts · app-paths.ts · host-launcher.ts · host-client.ts
├── ipc/register.ts · ipc/result.ts · ipc/terminal-ports.ts
├── ipc/register-{catalog,workspace,tasks,lifecycle,diff,switch,layout,app}.ts
├── ipc/validate-{common,catalog,workspace,tasks,lifecycle,diff,switch,layout,app}.ts
├── close-flow.ts · open-external.ts

src/preload/preload.ts
src/shared/ipc-contract.ts              # só tipos, compartilhado por main, preload e renderer

src/renderer/
├── index.html · main.tsx · App.tsx
├── theme/tokens.css · theme/bands.ts
├── store/workspace-store.ts · store/layout-store.ts
├── components/TopBar.tsx · Tree/… · Grid/… · Panel/… · TerminalView.tsx
│             NewTaskDialog.tsx · ModelSelect.tsx · PermissionSelect.tsx
│             DiffView/… · ConfirmDialog.tsx · CloseDialog.tsx

tests/unit/… · tests/integration/… · tests/perf/… · tests/arch/… · tests/e2e/… · tests/fixtures/… · tests/support/…
```

**Structure Decision**: pacote único com fronteiras por diretório, impostas pelo teste de arquitetura e por `tsconfig` separados (`tsconfig.node.json` para core, host e main; `tsconfig.web.json` para renderer). Um monorepo com pacotes separados seria a alternativa; foi adiado porque a fatia não publica pacotes e a regra de fronteira já é verificada por teste.

## Build e passos novos

- `postinstall`: `electron-rebuild -f -w node-pty` (recompila para o ABI do Electron; no Windows exige Visual Studio Build Tools com C++ e Python 3).
- `electron-vite build` gera `out/main`, `out/preload`, `out/host`, `out/renderer`; o hospedeiro é uma entrada extra do build do main.
- `electron-builder` empacota com `asarUnpack` para `node-pty` e `out/host`, fuse `runAsNode: true`; instalador NSIS não assinado nesta fatia.
- CI (fora das tasks desta fatia, ver pendências): matriz Windows, macOS e Linux só com build.

## Complexity Tracking

| Item | Por que é necessário | Alternativa mais simples rejeitada porque |
|------|----------------------|-------------------------------------------|
| Processo hospedeiro de PTY separado | Princípio III e História 2: processos e scrollback precisam sobreviver ao fechamento da janela | PTYs no processo principal morrem com o app |
| Resolução de shim npm no Windows | Princípio VIII: `.cmd` passa por `cmd.exe` e permite injeção pelo enunciado | Lançar `claude.cmd` direto expõe o enunciado ao reparse do `cmd.exe` |
