# Validação — 27/10/2026

## Resultados

| Verificação | Resultado |
| --- | --- |
| Build Electron/Vite | Passou |
| Typecheck completo (Node, renderer e testes) | Passou |
| ESLint dos arquivos alterados e novos | Passou |
| ESLint completo | 29 erros e 1 aviso remanescentes em arquivos não alterados; baseline: 31 erros e 1 aviso |
| Arquitetura | 8/8 passaram |
| Bateria direcionada de layout, editor, terminal e regressões | 139/139 passaram |
| Suíte unitária/componentes completa | 1815 passaram; 28 falharam, de 1843 testes |
| Integração | Executada e reexecutada; permanece com falhas. Baseline medido: 171 passaram e 26 falharam |
| E2E Electron (18 cenários) | 18/18 passaram na execução completa; captura final revalidada separadamente |

O baseline foi executado antes de alterar arquivos rastreados. Corrigidos bloqueios de compilação anteriores (string de teste inválida, inferência de tipo de evento e tipagens de fixtures), sem mudar lógica de negócio. Não foram corrigidas falhas independentes de subsistemas fora do redesign, conforme escopo acordado.

## Regressões A–H

| Cenário | Evidência |
| --- | --- |
| A — agentes paralelos e resize | E2E launch-and-converse e redesign; dois PTYs reais, eco independente e divisor por ponteiro |
| B — editor com dois terminais | E2E redesign: entrada automática em Desenvolvimento e geometria abaixo dos terminais |
| C — foco/restauração | Mesmo DOM de xterm/CodeMirror, rascunho preservado, expansão por atalho e retorno |
| D — múltiplos arquivos/divisões | E2E editor e redesign; sincronização do arquivo dividido, gutter e salvar explícito |
| E — Git | E2E git-intellij: diff, seleção, commits em dois repositórios temporários e push com confirmação |
| F — reabrir e recuperar | E2E redesign e close-and-reopen: modo/painéis salvos, histórico pesquisável e PID preservado |
| G — layout/sidebar/atalhos | E2E redesign, run e testes de contexto; layout personalizado protegido |
| H — erros/confirmações/foco | E2E de fechamento cancelado, falha de etapa de execução e componentes de confirmação/rascunho |

## Ajustes dos testes E2E

- Caminhos temporários Windows usam realpathSync.native, como o fixture Git existente. Nomes curtos 8.3 causavam FILE_OUTSIDE_ROOT nos testes de edição e execução.
- Seletores de Agente/Lançar e opções de configuração foram delimitados ao diálogo/listbox correto, evitando confusão com Relançar e com as opções do novo seletor de layout.
- Asserções de conteúdo do terminal usam a busca real do xterm. A classe interna .xterm-rows não existe no renderer WebGL utilizado. Isso verifica o buffer renderizado sem expor uma API de teste na aplicação.
- No Windows, encerramento forçado reporta código 1, em vez de sinal SIGKILL. Reanexação é verificada por histórico, eco ao vivo e identidade do PID; contagem de palavras no stream bruto não é válida porque ConPTY repinta linhas ao redimensionar.
- O teste de etapa anterior verifica que a execução fail existiu e que dev não foi lançada. O aplicativo existente não abre automaticamente o painel de uma etapa que falhou; não foi alterado esse comportamento.
- Limpeza do repositório do editor dividido foi adiada até fechar o Electron, evitando EPERM por handles ainda abertos.

## Falhas remanescentes da suíte completa

- tests/unit/renderer/ChangeTree.test.tsx — ChangeTree double click opens the file with its absolute path
- tests/unit/renderer/CommitPanel-commit.test.tsx — CommitPanel commit lists Changes and Unversioned Files with counts and the branch of each repo
- tests/unit/renderer/RunConfigsDialog.test.tsx — RunConfigsDialog — árvore Adicionar configuração creates a blank config of the tool, selected, saved on Aplicar without id
- tests/unit/renderer/git/git-store.test.ts — buildChangeTree lists a repo without changes only when there is more than one repo
- tests/unit/main/packaging.test.ts — empacotamento builds the Linux package from the unpacked app, with the installer scripts
- tests/unit/support/fakes-io.test.ts — MemoryFileSystem writes, reads, lists, renames and removes
- tests/unit/preload/preload.test.ts — preload exposes exactly the keys of contracts/ipc.md on window.melinna
- tests/unit/core/execution/execution-events.test.ts — ExecutionService.onBusy / onIdle announces busy on output and idle after the quiet period, with the status already updated
- tests/unit/core/execution/execution-events.test.ts — ExecutionService.onBusy / onIdle announces each busy → idle cycle
- tests/unit/core/files/search.test.ts — searchProject — texto searches with a regular expression, per line
- tests/unit/core/files/search.test.ts — searchProject — filtro de arquivos accepts several masks separated by comma and braces
- tests/unit/core/persistence/state-schema.test.ts — parseState — esquema 2 → 3 reads a v3 state without changing it
- tests/unit/core/persistence/state-store.test.ts — StateStore saves atomically after a 300 ms debounce, coalescing calls
- tests/unit/core/persistence/state-store.test.ts — StateStore copies a v2 file to state.v2.json.bak before the first v4 write, once
- tests/unit/core/prompts/prompt-queue.test.ts — PromptQueue.enqueue sends right away to an idle session with an empty queue
- tests/unit/core/prompts/prompt-queue.test.ts — PromptQueue.enqueue does not send a second time to an idle session before the agent reacts to the first
- tests/unit/core/run/run-service.test.ts — RunService.start splits maven objectives into a vector (space splits, quotes group)
- tests/unit/core/run/run-service.test.ts — RunService.start — antes de lançar asks for the wrapper confirmation of a step before any step runs, and a refusal runs nothing
- tests/unit/core/run/run-service.test.ts — RunService.start — wrapper without the execute bit wrapper-sh runs "sh <wrapper> <args>" without -c
- tests/unit/core/run/run-service.test.ts — RunService.start — wrapper without the execute bit system-tool runs mvn from the system
- tests/unit/core/run/run-service.test.ts — RunService.start — wrapper without the execute bit refuses a choice once the wrapper has the execute bit
- tests/unit/core/workspace/create-workspace.test.ts — WorkspaceService.openWorkspace — pastas records the single folder as the primary one
- tests/unit/core/workspace/rename-and-residue.test.ts — WorkspaceService: renomear renames groups and tasks, trimming, and persists
- tests/unit/core/workspace/workspace-service.test.ts — WorkspaceService persists through the state store
- tests/unit/main/ipc/register-layout.test.ts — layout IPC gets the default and persists a valid layout in state.json
- tests/unit/main/ipc/register-prompts.test.ts — prompts IPC save, list, duplicate, remove refuses an unknown workspace scope with the contract message
- tests/unit/main/ipc/register-run.test.ts — run IPC refuses to remove a config that is running
- tests/unit/main/ipc/register-workspace.test.ts — workspace IPC opens a folder as a workspace, reusing it on the next opening

As falhas de integração incluem diferenças CRLF/LF de Git no Windows, nomes curtos/canônicos de pastas, expectativas de eco em ConPTY, limpeza EPERM e expectativas antigas de anexos/commits. Nenhuma dessas falhas foi tratada como aprovação. O aviso de canvas em jsdom pertence aos testes do backdrop legado; o runtime novo da Home usa a imagem original diretamente.

## Comandos

- npm.cmd run build
- npm.cmd run typecheck
- npm.cmd run lint
- npm.cmd run test:unit
- npm.cmd run test:integration
- npm.cmd run test:arch
- npm.cmd run test:e2e

Os testes usam perfis MELINNA_USER_DATA, agentes falsos e repositórios temporários. Não operam nas sessões, credenciais ou repositórios reais do usuário. Não foram executados benchmarks de performance nem empacotamento/instalação Linux; o ambiente utilizado foi Windows.
