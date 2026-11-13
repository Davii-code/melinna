# Tasks - 010 Editor IDE

Modo Spec Kit. Testes escritos antes do comportamento, execucao somente pelo dono. Todas as tasks sao complexas exceto T011/T023 (modulos puros de estado no contrato ja definido).

## Fundacao

- [x] T001 Definir tipos/limites/validacoes em `src/shared/ide-types.ts` e testes `tests/unit/core/ide/validation.test.ts`: entradas malformadas sao recusadas.
- [x] T002 Implementar framing UTF-8 incremental em `src/core/ide/framing.ts` com testes de fragmentos/multiplas mensagens/limites em `tests/unit/core/ide/framing.test.ts`.
- [x] T003 Implementar porta/cliente correlacionado em `src/core/ports/protocol-process.ts` e `src/core/ide/protocol-client.ts`, com testes timeout/exit/eventos em `tests/unit/core/ide/protocol-client.test.ts`.
- [x] T004 Implementar spawn seguro em `src/adapters/node-protocol-process.ts` com testes de argumentos, lifecycle e encerramento em `tests/unit/adapters/node-protocol-process.test.ts`.

## US2 - Sincronizacao

- [x] T005 [US2] Implementar revalidacao externa dos drafts em `src/renderer/components/Editor/external-sync.ts` com testes em `tests/unit/renderer/external-sync.test.ts`.
- [x] T006 [US2] Integrar aviso/comparacao/recarga em `EditorPane.tsx` com testes de componente: rascunho sujo e leitura concorrente nao perdem texto.

## US3 - Linguagens

- [x] T007 [US3] Implementar lifecycle LSP/sync/capabilities em `src/core/ide/language-service.ts` com testes em `tests/unit/core/ide/language-service.test.ts`.
- [x] T008 [US3] Implementar snapshot/validacao de workspace edits em `src/renderer/components/Ide/workspace-edits.ts` com testes de versoes, overlap, docs fechados e aplicacao atomica.
- [x] T009 [US3] Implementar contribuicoes de editor em `src/renderer/components/Ide/editor-tools.ts` com testes de posicao, completions e diagnostico sem resposta obsoleta.

## US4 - Depuracao

- [x] T010 [US4] Implementar ciclo e comandos DAP em `src/core/ide/debug-service.ts` com testes handshake initialized/launch e capabilities.
- [x] T011 [US4] Implementar modelo de breakpoints/estado DAP em `src/renderer/components/Ide/debug-state.ts` com testes de persistencia segura e invalidacao de variaveis.

## US5 - HTTP

- [x] T012 [US5] Implementar HTTP limitado/cancelavel em `src/adapters/node-http-client.ts` com testes rede/timeout/redirect/tamanho em `tests/unit/adapters/node-http-client.test.ts`.

## US6 - SQLite

- [x] T013 [US6] Implementar engine SQLite readOnly em `src/adapters/sqlite-worker.ts` com testes authorizer/schema/consulta/limites.
- [x] T014 [US6] Implementar lifecycle worker em `src/adapters/node-database-client.ts` com testes timeout/close/path em `tests/unit/adapters/node-database-client.test.ts`.

## Integracao

- [x] T015 Definir contrato IPC IDE em `src/shared/ipc-contract.ts`, preload e fake API; escrever testes de exposicao dos metodos.
- [x] T016 Implementar validacao e roteamento LSP/DAP em `src/main/ipc/register-ide.ts` e `src/main/ide-service.ts` com testes de origem/raiz/URI/metodo.
- [x] T017 Integrar HTTP/SQLite e cleanup em `src/main/main.ts` e registrador IDE, com testes cancelamento/erro/fechamento.

## Ferramentas UI

- [x] T018 Criar configuracao/sessao LSP e diagnosticos em `src/renderer/components/Ide/LanguageTools.tsx`, com testes de configuracao explicita e navegacao.
- [x] T019 Integrar completion/hover/simbolos/referencias/rename/code actions em `LanguageTools.tsx` e editor; escrever testes do fluxo de edicao confirmada.
- [x] T020 Criar ferramenta DAP em `src/renderer/components/Ide/DebugTools.tsx` com testes de comandos, pilha, escopos e variaveis.
- [x] T021 Criar cliente HTTP em `src/renderer/components/Ide/HttpTools.tsx` com testes de enviar/cancelar/erro e historico sem segredos.
- [x] T022 Criar ferramenta SQLite em `src/renderer/components/Ide/DatabaseTools.tsx` com testes de abrir/schema/consultar/fechar e readOnly.

## US1 - Shell

- [x] T023 [US1] Criar estado/layout persistente de ferramentas em `src/renderer/components/Ide/tool-layout.ts` com testes de validacao e clamp.
- [x] T024 [US1] Criar painel acessivel em `src/renderer/components/Ide/IdeTools.tsx` e estilos com testes de selecao/resize por teclado.
- [x] T025 [US1] Integrar painel/atalho no `src/renderer/App.tsx` e ToolStrip preservando o layout atual; escrever testes de toggle e preservacao do editor.

## Documentacao

- [x] T026 Documentar configuracao de servidores/adaptadores, recursos por linguagem e limites em `docs/editor-ide.md`; completar cobertura de erros e roteiro manual da feature.

## Dependencias e aceite independente

T001-T004 fundam o transporte; T005-T006 sincronizacao; T007-T009 linguagens; T010-T011 debug; T012 HTTP e T013-T014 SQLite; T015-T017 integracao; T018-T022 cada ferramenta isolada; T023-T025 shell; T026 fecha documentacao. Cada task inclui testes de sucesso e erro e o comportamento descrito na respectiva US. Sem tasks de executar testes/build/lint/revisao.

Paralelismo potencial: HTTP e SQLite apos contratos; execucao atual sera sequencial. MVP: sincronizacao e linguagem, avancando ate concluir todas as historias autorizadas.
