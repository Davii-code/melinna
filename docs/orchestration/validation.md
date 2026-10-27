# Validação da orquestração visual

Data: 27/10/2026. Ambiente: Windows, Electron/React do projeto; Claude Code 2.1.302 e Codex CLI 0.164.0.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Typecheck Node, renderer e testes | Aprovado após todas as alterações |
| Build Electron/Vite | Aprovado após todas as alterações |
| ESLint dos novos módulos, integrações e testes da feature | Aprovado |
| Arquitetura | 8/8 aprovados |
| Núcleo, runtime, MCP, interface e preload, execução focada | 35 aprovados; 2 smokes reais ignorados por padrão nesta execução |
| Smoke real Claude → Codex e Codex → Claude | 2/2 aprovados em execução opt-in separada |
| E2E Electron completo | 19/19 aprovados |
| E2E da orquestração após os ajustes finais | 1/1 aprovado novamente |
| Unitários/componentes completos, última execução | 1.873 testes: 1.845 aprovados, 26 falhos, 2 smokes ignorados por padrão |
| Integração completa | 197 testes: 167 aprovados, 26 falhos, 4 pendentes após timeout de worker |
| Histórico Git isolado após o timeout da integração | 9/9 aprovados |
| ESLint global | 28 erros e 1 aviso; baseline tinha 29 erros e 1 aviso |

**A suíte global não está inteiramente verde.** Os 26 nomes de testes unitários que falharam na execução final também falharam na comparação da versão anterior. Os 26 testes de integração falhos coincidem com o baseline. Não foram introduzidas novas falhas persistentes identificadas nessa comparação.

O baseline foi executado num worktree temporário do commit 768d333, com as mesmas dependências e ambiente. Sua suíte unitária teve 1.841 testes, 1.810 aprovados e 31 falhos. Há variação de resultados em testes antigos sensíveis a tempo/carga: CommitPanel durante merge, por exemplo, falhou numa execução ampla e passou isoladamente tanto no baseline quanto na feature. O teste novo de integração de patches excedeu inicialmente 15 segundos sob carga concorrente; seu timeout foi ajustado para 60 segundos, e passou nas execuções seguintes.

O worker de histórico Git deixou quatro testes pendentes na execução de integração ampla. O arquivo completo foi repetido isoladamente e seus nove testes passaram; isso não transforma a execução ampla em sucesso. As demais falhas incluem CRLF, caminhos Windows curtos/canônicos, expectativas antigas de configurações e comportamento ConPTY.

O lint global foi comparado por caminho relativo, regra e mensagem: nenhuma nova ocorrência identificada. Permanecem, entre outros, três erros antigos de união com void no contrato IPC compartilhado. Esses contratos não foram alterados apenas para limpar o lint.

## Cobertura nova

- Scheduler: execução do coordenador, retomada por ID, delegação a dois provedores, concorrência, pausa de fila, cancelamento, idempotência, rejeição de papéis desconhecidos e limites de trabalhos.
- Recuperação: trabalhos em andamento viram interrompidos sem relançamento automático; armazenamento corrompido não é sobrescrito.
- MCP por HTTP real: handshake, descoberta de ferramentas, autorização por execução, revogação, rejeição de origem de navegador e ferramentas desconhecidas.
- Processos reais com CLI simulado: JSONL/stream-json, IDs de sessão, uso reportado, credencial redigida, saída inválida, exit code de falha, ausência de evento final, timeout e cancelamento.
- Git real em fixtures: worktrees separados, inclusão de arquivos novos em patch, preservação do índice original, aplicação sequencial, bloqueio de edições externas e ausência de commits automáticos.
- Interface: montagem/edição de equipe, campos, envio de objetivo, adicionar/remover papel, console, revisão de patch, confirmação de aplicação e Escape.
- Electron completo: API IPC real, resolução dos executáveis simulados pelo mecanismo npm-shim, ponte MCP, processos filhos, coordenação nos dois sentidos, resultados, aplicação de patch e persistência após reabrir.
- Regressão E2E existente: terminais paralelos, histórico/reattach, editor, editor dividido, layouts, Git/commit/push em repositórios descartáveis, múltiplas pastas, imagens, prompts, configurações de execução e atalhos.

O teste E2E verifica explicitamente as versões dos executáveis simulados antes de iniciar a equipe, para impedir que um erro na configuração do catálogo acione CLIs reais durante a suíte simulada.

## Testes com modelos reais

Foram executadas as duas direções com um único trabalhador em leitura, objetivo de devolver o marcador MELINNA_SMOKE_OK, timeout curto e repositórios temporários. Nenhum código do workspace do usuário foi fornecido como tarefa, alterado, commitado ou enviado a remoto por esses smokes. A tarefa instruiu os agentes a não inspecionar arquivos nem executar comandos.

O primeiro teste Codex → Claude revelou uma incompatibilidade real: a chamada MCP de delegação exigia aprovação enquanto a sessão estava em never. A correção habilita explicitamente apenas as cinco ferramentas do servidor local Melinna para a execução autorizada pelo usuário, usando lista permitida e configurações de aprovação por ferramenta. O sandbox não foi desabilitado; nenhuma configuração global foi escrita. [Referência oficial](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Também foi corrigida uma conclusão enganosa: recusas MCP de aprovação reportadas pelo CLI agora produzem erro, mesmo que a mensagem final do modelo diga que encerrou a tarefa. Há regressão simulada para esse caso.

Outra correção evita um turno adicional pago quando o coordenador já recebeu o resultado terminado via get_task, collect_results ou wait_tasks. Resultados de trabalhos que terminam depois do turno continuam sendo entregues automaticamente. O comportamento tem teste específico.

Os dois smokes finais passaram com os provedores reais. Eles confirmam delegação, execução do trabalhador e consumo do resultado; não demonstram economia de tokens, edição real de código pelos modelos ou compatibilidade com outras versões/contas. Valores monetários reportados por apenas um provedor continuam sendo parciais.

## Como repetir

Comandos locais sem modelos reais:

~~~powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:arch
npx.cmd vitest run --project unit --project unit:renderer tests/unit/core/orchestration tests/unit/renderer/OrchestrationWorkspace.test.tsx tests/unit/preload/preload.test.ts
npx.cmd playwright test tests/e2e/orchestration.spec.ts
~~~

Os smokes reais são opt-in para não consumir uso em uma execução comum de CI:

~~~powershell
$env:MELINNA_LIVE_ORCHESTRATION = '1'
npx.cmd vitest run --project unit tests/unit/core/orchestration/real-cli.smoke.test.ts
Remove-Item Env:MELINNA_LIVE_ORCHESTRATION
~~~

[Captura real da tela com agentes simulados](screenshots/visual-team.png).

## Limitações que continuam abertas

Não foram validados Linux/macOS, empacotamento/instalação, recuperação após crash abrupto do sistema operacional, grandes volumes de histórico, carga prolongada, todos os tipos de patch/binários, todos os modos de autenticação ou permissões corporativas. Os testes reais foram de leitura; edição real por modelos e revisão humana dos resultados precisam de rodada própria.

As sessões da feature continuam sendo consoles programáticos, não terminais TUI interativos. Não há host durável para continuar a orquestração após fechar o Electron. A importação do Kit é assistida por texto; não executa configurações de terceiros automaticamente.

## Falhas unitárias/componentes remanescentes

- ChangeTree double click opens the file with its absolute path
- RunConfigsDialog — árvore Adicionar configuração creates a blank config of the tool, selected, saved on Aplicar without id
- buildChangeTree lists a repo without changes only when there is more than one repo
- empacotamento builds the Linux package from the unpacked app, with the installer scripts
- MemoryFileSystem writes, reads, lists, renames and removes
- ExecutionService.onBusy / onIdle announces busy on output and idle after the quiet period, with the status already updated
- ExecutionService.onBusy / onIdle announces each busy → idle cycle
- searchProject — texto searches with a regular expression, per line
- searchProject — filtro de arquivos accepts several masks separated by comma and braces
- parseState — esquema 2 → 3 reads a v3 state without changing it
- StateStore saves atomically after a 300 ms debounce, coalescing calls
- StateStore copies a v2 file to state.v2.json.bak before the first v4 write, once
- PromptQueue.enqueue sends right away to an idle session with an empty queue
- PromptQueue.enqueue does not send a second time to an idle session before the agent reacts to the first
- RunService.start splits maven objectives into a vector (space splits, quotes group)
- RunService.start — antes de lançar asks for the wrapper confirmation of a step before any step runs, and a refusal runs nothing
- RunService.start — wrapper without the execute bit wrapper-sh runs "sh <wrapper> <args>" without -c
- RunService.start — wrapper without the execute bit system-tool runs mvn from the system
- RunService.start — wrapper without the execute bit refuses a choice once the wrapper has the execute bit
- WorkspaceService.openWorkspace — pastas records the single folder as the primary one
- WorkspaceService: renomear renames groups and tasks, trimming, and persists
- WorkspaceService persists through the state store
- layout IPC gets the default and persists a valid layout in state.json
- prompts IPC save, list, duplicate, remove refuses an unknown workspace scope with the contract message
- run IPC refuses to remove a config that is running
- workspace IPC opens a folder as a workspace, reusing it on the next opening

## Falhas de integração remanescentes

- AttachmentService.saveClipboardImage numbers images saved in the same millisecond and uses the extension of the real format
- prompts: envio a uma sessão delivers the resolved prompt to the agent as typed and confirmed input
- prompts: envio a várias sessões gives each session its own folder and leaves the unmarked one alone
- RunService com PTY real runs "npm run dev" of the node-app and keeps the output in the history
- RunService com PTY real reuses the live execution on a second start
- RunService com PTY real rerun writes the separator into the same history and runs again
- RunService com PTY real stops through executions.stop
- RunService com PTY real keeps an argument with spaces and quotes intact
- RunService com PTY real fails with PROGRAM_NOT_FOUND for a program that does not exist
- RunService com PTY real force-ends a process that ignores Ctrl+C after the stop deadline
- RunService com PTY real after the service restarts, reconciles the live command and still reruns it
- RunService — ambiente e opções do runtime gives the real process the variables of the config and NODE_OPTIONS from runtimeOptions
- RunService — ambiente e opções do runtime keeps the variables on a rerun from the saved execution
- RunService — ambiente e opções do runtime never leaks the variable values into the log
- RunService — antes de lançar runs the step first, waits for it and only then runs the main config
- RunService — antes de lançar does not run the main config when the step exits with 1
- RunService — sem shell delivers "& calc" and quotes to the process as literal arguments
- flow control stops delivering above 1 MB unacked, resumes on ack and delivers every byte in order
- execução direta na pasta runs in a folder outside git, with no worktree, and removal keeps the folder
- execução direta na pasta relaunches in the same folder
- execução direta na pasta diffs the folder against HEAD inside git and returns an empty diff outside git
- GitService.discard deletes new files, reverts changed and removed ones, and restores the old name of a rename
- GitService.checkout creates the local branch tracking a remote-only branch
- GitService.commit includes the old path of a staged rename
- GitService.abortMerge asks for confirmation and then restores the state before the merge
- GitService pull integrates remote commits with a merge
