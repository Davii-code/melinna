# Modelo de dados

- **ToolSession:** id, protocol (`lsp`/`dap`), root, executable, args, lifecycle (`starting`/`ready`/`stopped`/`failed`), capabilities. Limite global e encerramento por janela.
- **OpenDocument:** URI validada dentro da raiz, languageId, versão monotônica e texto no renderer; nenhum texto persistido além do fluxo de rascunho existente.
- **Location/Diagnostic:** URI, range zero-based, severidade, mensagem. Diagnósticos isolados por sessão/URI.
- **WorkspaceEditPreview:** lista de alterações por URI/versão, textos e intervalos; validação completa antes de aplicar qualquer alteração aos drafts. Operações create/delete/rename file recusadas nesta entrega.
- **DebugState:** sessão, status, threads, stack frames, escopos, variáveis e breakpoints por caminho/linha. Referências de variáveis expiram ao continuar/reiniciar.
- **HttpRequest/Response:** método/URL/headers/body em memória; status/headers/body/duration/truncated. Identificador permite cancelamento. Histórico somente metadados seguros.
- **DatabaseConnection:** id, caminho real do banco, modo readOnly fixo; worker exclusivo. Resultados possuem colunas/valores/affectedRows/truncated. Nenhuma conexão ou resultado SQL persistido.
- **ToolLayout:** aba selecionada, abertura e altura limitada; versão de formato local, fallback seguro para valores inválidos.
