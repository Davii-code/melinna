# Contratos internos IDE

Novos canais registrados no IPC confiável existente. Payloads e retornos serializáveis; erro segue MelinnaError/toIpcError. Argumentos unknown são validados na fronteira.

| Operação   | Entrada                                      | Resultado                              |
| ---------- | -------------------------------------------- | -------------------------------------- |
| start      | protocol, root, executable, args             | sessionId, capabilities                |
| stop       | sessionId                                    | encerramento idempotente               |
| request    | sessionId, método/comando permitido, params  | resposta limitada do protocolo         |
| notify     | sessionId, notificação LSP permitida, params | confirmação de entrega                 |
| event      | sessionId e envelope validado                | push apenas para janela confiável      |
| httpSend   | requestId, método, URL, headers, body        | status/headers/body/duration/truncated |
| httpCancel | requestId                                    | idempotente                            |
| dbOpen     | caminho validado, readOnly                   | connectionId e schema                  |
| dbQuery    | connectionId, SQL somente leitura            | columns/rows/truncated                 |
| dbClose    | connectionId                                 | idempotente                            |

O canal request não é proxy arbitrário: listas permitidas para LSP e DAP, com validação específica para operações de documento/caminho. O servidor não recebe um canal IPC do app. Mensagens server→client que tentam applyEdit ou execução/configuração são recusadas ou apresentadas para confirmação, nunca executadas silenciosamente.

LSP: initialize/initialized; didOpen/didChange/didClose/didSave; completion/hover/definition/references/documentSymbol/workspaceSymbol/rename/codeAction. Renames/actions não gravam disco pelo app. DAP: initialize, launch/attach, setBreakpoints, configurationDone, threads, stackTrace, scopes, variables, continue, pause, next, stepIn, stepOut, disconnect. Run/attach são explícitos; comandos shell de reverse requests não são aceitos.

HTTP apenas http/https; headers proibidos de log. SQLite somente leitura, sem ATTACH/extension, consultas em worker com timeout e limites; escrita não exposta. Raízes são conferidas por realpath pelo main; `.git` e destinos fora do workspace são recusados.

## Validações específicas

start: protocol enum lsp/dap; root absoluta realpath registrada; executable absoluto nativo ou resolvido em PATH, sem .cmd/.bat/.sh; args ate 64 strings de 4096 caracteres; nenhuma opcao shell/env. SessionId ate 64 caracteres, gerado pelo main.

LSP textDocument: uri file: sem query/fragment dentro de raiz por realpath, linguagem ate 64 chars, versao inteiro >=0 monotonica, texto ate 5 MiB; posicao linha/caractere inteiros >=0, limites conferidos contra o snapshot atual quando houver. Rename newName ate 256 chars sem controle; referencias context.includeDeclaration boolean; simbolos query ate 512 chars; ranges ordenados. didChange textDocument.version monotonica; didClose/didSave de URI ja aberta. Completion/hover/definition/references/rename usam documento aberto. Code actions aceitam apenas edits validados, sem execucao de command do servidor.

DAP setBreakpoints: source.path realpath dentro de raiz, maximo 1000 linhas inteiras >=1; stackTrace threadId inteiro >=0, startFrame>=0 e levels<=100; scopes frameId inteiro>=0; variables variablesReference inteiro>=0, start>=0 e count<=500. Continue/pause/step threadId>=0; launch/attach JSON objeto <=64 KiB, iniciado explicitamente, sem comandos reverse. Configuracoes nao vem do repositorio automaticamente. Respostas DAP sao limitadas pelo transporte e resultado validado antes de apresentacao.

Erros: INPUT_INVALID (forma/limites/metodo), FILE_OUTSIDE_ROOT (raiz/URI), FILE_CONFLICT (snapshot de edit), LIMIT_REACHED (sessoes/pedidos), PROGRAM_NOT_FOUND/UNSAFE_LAUNCHER (programa), IO_ERROR (processo/protocolo/timeout). Nenhum envelope bruto - incluido no log.
