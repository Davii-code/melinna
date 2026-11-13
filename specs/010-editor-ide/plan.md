# Plan — Ambiente de desenvolvimento integrado

## Contexto técnico

TypeScript estrito, Electron 44, React 19, CodeMirror 6, xterm e arquitetura core/ports/adapters. Sem migração para Rust/Tauri. Dependências novas: nenhuma. Linguagens iniciais JS/TS e Java; servidores LSP e adaptadores DAP configurados explicitamente por executable/argv e diretório.

Autorização: o usuário pediu implementar todas as etapas propostas e seguir as recomendações em dúvidas. Os contratos e decisões abaixo fazem parte da implementação autorizada, sem alterar a constitution nem o Spec Kit.

## Constitution check

- Agentes continuam CLI/PTY; ferramentas LSP/DAP são processos auxiliares independentes, sem SDK de agente.
- Salvamento de código apenas explícito; alterações semânticas entram em rascunhos e usam o FilesService existente ao salvar.
- Core não importa APIs Node/Electron/React. Portas de transporte e arquivos injetadas.
- SQLite abre somente leitura; escrita SQL não faz parte desta entrega.
- Nenhuma dependência nova; sem copiar código/assets da referência; identidade Melinna preservada.
- Testes escritos antes de cada comportamento; testes/build/lint/tela/revisão de código só por pedido do usuário.

## Arquitetura

1. `core/ide/` contém modelos e serviços de protocolo LSP/DAP e validação de limites; uma porta representa subprocesso bidirecional. `adapters/` implementa spawn, framing Content-Length e SQLite. O main compõe dependências e guarda sessões por janela/pasta.
2. Protocolo com parser incremental de bytes, UTF-8, limite de header/body e suporte a múltiplas mensagens por chunk. JSON-RPC/LSP usa id/method/params/result/error. DAP usa seq/type/command/arguments/body. Cada protocolo mantém sua correlação e evento; não confundir os envelopes.
3. Início explícito por executable/argv/cwd. Node adapter sem shell, valida caminho real de cwd, recusa scripts shell e fecha árvore de processo na saída. Timeouts, rejeição de pedidos pendentes e cancelamento liberam mapas/listeners.
4. Estado de documentos permanece no DraftStore existente. Respostas LSP têm escopo de sessão/documento/versão. Workspace edits são normalizados e validados antes da confirmação, aplicados aos drafts e nunca gravados pelo servidor diretamente via IPC.
5. Ferramentas nativas HTTP/SQLite executam no main/adapter, nunca acessam APIs de sistema diretamente do renderer. SQLite usa `node:sqlite` em worker para não bloquear main. ReadOnly impede escrita; authorizer nega ATTACH, DETACH, PRAGMA e funções de extensão. Schema é consultado via sqlite_schema e table-valued pragma_table_info; allowExtension permanece false.
6. UI reutiliza tokens e componentes atuais. Painel de ferramentas redimensionável, persistido localmente, com regiões/labels acessíveis. Estado de conexão, mensagens de erro e capacidades disponíveis são explícitos.

## Contratos

Ver `contracts/ide.md` e `data-model.md`. Canais novos ficam sob namespace ide e usam registrador confiável existente. Eventos carregam sessionId, root e document URI quando aplicável. Cada handler valida tipos/tamanhos antes do serviço. Sem mudança no protocolo PTY ou no catálogo de agentes.

## Plano de validação (sem execução automática)

Vitest: parser fragmentado/multibyte/limites, correlação/timeout/exit, LSP handshake/documents/edits, DAP handshake/breakpoints/scopes, HTTP cancel/protocol/limites, SQLite readOnly/paths/limits e sincronização de rascunhos com leituras concorrentes. Testing Library: ferramentas, acessibilidade, estado vazio/erro, prompts de confirmação e preservação dos drafts.

Roteiro de tela futuro: alternar ferramentas, redimensionar teclado/ponteiro, abrir splits do mesmo arquivo, modificar arquivo externamente, iniciar servidor/adaptador local, navegar diagnóstico/definição, confirmar rename sem salvar, cancelar HTTP e tentar SQL de escrita em readOnly.

## Limites e tratamento de erros

No máximo 4 sessões auxiliares, 128 pedidos por sessão, mensagens até 8 MiB, headers até 8 KiB, timeout padrão 20 s. HTTP até 2 MiB de resposta e 30 s. SQLite até 500 linhas e 2 MiB; timeout/worker encerrado para consultas lentas. Limites configurados no código e testados. Logs estruturados apenas metadados de operação, sessão, duração, código e tamanho, sem conteúdo sensível.

## Ordem e integração

T001–T004 contratos e transporte; T005–T006 sincronização; T007–T009 linguagens; T010–T011 depuração; T012 HTTP; T013–T014 SQLite; T015–T017 IPC e composição; T018–T022 ferramentas; T023–T025 shell; T026 documentação. Tasks complexas ficam na sessão principal; os módulos puros T011/T023 foram delegados ao implementer. A revisão de planejamento precedeu a implementação e teve os bloqueantes resolvidos.

## Complexity tracking

Nenhuma exceção planejada à constitution. A execução de ferramentas externas exige configuração e início pelo usuário; a aplicação não instala programas nem executa configuração fornecida pelo repositório automaticamente.

## Precisoes dos contratos e sincronizacao

- LSP negocia UTF-16 e full ou incremental sync. A camada envia full text somente para sync=1; para sync=2 calcula mudanca unica que cobre o documento com range do texto anterior. Sync ausente/zero nao recebe didChange. Pedidos server-to-client retornam MethodNotFound; workspace/configuration responde apenas configuracao vazia e workspace/workspaceFolders a raiz registrada, sem executar comandos. applyEdit nunca e aceito silenciosamente.
- DAP initialize inicia capacidades; launch/attach permanece pendente enquanto se aguarda initialized. Entao setBreakpoints/configurationDone (somente se suportado) e aguarda launch/attach, evitando deadlock. Variaveis e frames sao limpos ao continuar. Reverse requests runInTerminal/startDebugging sao recusados.
- Workspace edits: capturar URI/texto/baseHash/versao de cada documento (incluindo fechados via FilesService.read), validar containment realpath, intervalos UTF-16 e ausencia de overlap, confirmar a previa, revalidar identidade de todos snapshots, aplicar todos os drafts sincronicamente. Versao ausente/null exige snapshot de texto capturado; qualquer conflito aborta o conjunto sem mudanca parcial. Operacoes de criar/apagar/mover arquivos nao suportadas.
- Configuracoes de executable e breakpoints sao versionadas em localStorage por raiz, sem environment secrets, tokens, argumentos JSON de launch/attach ou conteudo de codigo. Nenhum processo reinicia automaticamente.
- HTTP history em memoria: metodo, origin sem userinfo/query, status e duracao apenas. Redirect manual limitado a 5; credenciais/headers sensiveis nao atravessam origem. Body ate 1 MiB, headers ate 64 entradas/32 KiB, URL ate 4096. Resposta sempre texto escapado ou descricao binaria, nunca HTML executado.
