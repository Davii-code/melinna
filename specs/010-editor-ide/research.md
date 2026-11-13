# Pesquisa e decisões

- Manter Electron/TypeScript e CodeMirror: a base já entrega documentos compartilhados, splits e proteção de hash; trocar o editor acrescentaria migração sem resolver semântica de linguagem.
- Implementar LSP/DAP como processos externos explicitamente configurados; não acoplar ao catálogo nem ao PTY dos agentes. Protocolos oficiais: [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) e [DAP](https://microsoft.github.io/debug-adapter-protocol/specification).
- Usar stdio com Content-Length em bytes UTF-8 e limites. Transporte: [Node child_process](https://nodejs.org/api/child_process.html). Sem shell, sem executar configuração do repositório automaticamente.
- Servidores/adaptadores são ferramentas do usuário. O app mostra configuração, estado, erros e capacidades; não anuncia capacidades ausentes como implementadas pelo servidor.
- HTTP com fetch/AbortController nativos, executado somente por ação explícita; [Node globals](https://nodejs.org/api/globals.html#fetch).
- Banco inicial SQLite com engine nativo em worker; [Node sqlite](https://nodejs.org/api/sqlite.html). Modo readOnly real e proibição de ATTACH/extension. Sem banco remoto/segredos nesta entrega.
- Não importar código/assets externos. A análise de referência registra comportamento, não uma dependência.

Decisões delegadas pelo usuário em 13/11/2026. Nenhuma instalação de dependência npm prevista.

O typecheck Node inclui também `tests/unit/adapters/**/*.ts`, diretório criado para testes isolados de transporte/HTTP/worker. Testes reais de SQLite ficam em `tests/integration/adapters/ide-sqlite.test.ts`. Essa inclusão amplia o escopo do check existente.

O plan_reviewer foi executado antes da implementação. Os bloqueantes foram resolvidos: SQLite somente leitura, payloads limitados, snapshots de workspace edits e tarefas menores. Nenhuma revisão de código ou suite foi executada automaticamente.
