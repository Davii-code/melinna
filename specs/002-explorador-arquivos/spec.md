# Feature 002 — Explorador de arquivos (fatia 1: leitura)

## Por que

O Melinna hoje só mostra terminais. O objetivo do produto é ver os arquivos do projeto — como no VS
Code e no IntelliJ — e operar vários terminais ao mesmo tempo, na mesma janela.

Esta fatia entrega a **fundação de arquivos**: o app passa a saber listar e ler qualquer arquivo das
pastas que já abriu, com contenção verificada, e a interface ganha um explorador em árvore, somente
leitura. O editor (abas, salvar, `Ctrl+P`) é a fatia seguinte e depende deste contrato.

## Escopo entregue

1. **Contrato `files` na API do preload**: `roots()`, `list(path)`, `read(path)` (ver
   `specs/001-workspace-agentes-paralelos/contracts/ipc.md`).
2. **Raízes navegáveis**: o repositório de cada workspace aberto e o worktree de cada execução
   preparada. É isso que torna o explorador útil neste produto: dá para abrir a árvore **do agente**,
   não só a do repositório.
3. **Contenção por `realpath`**: caminho pedido é canonizado antes da checagem; link simbólico que
   escapa da raiz é recusado com `FILE_OUTSIDE_ROOT`. Nenhuma escrita existe nesta fatia.
4. **Limites**: 5.000 entradas por pasta (marcada como truncada) e 5 MB por leitura (conteúdo
   cortado); binário detectado por byte nulo e devolvido sem conteúdo.
5. **Interface**: alternância Workspaces | Arquivos na barra lateral, árvore com carga sob demanda
   (uma pasta por clique), tamanho de arquivo e pré-visualização em modal.

## Requisitos funcionais

| # | Requisito |
|---|---|
| RF1 | O explorador lista as raízes abertas num seletor, com worktrees identificados |
| RF2 | Clicar numa pasta carrega e expande o conteúdo no lugar, sem recarregar a árvore |
| RF3 | Clicar num arquivo abre pré-visualização do conteúdo, marcando binário e corte |
| RF4 | Um erro de leitura aparece na linha da pasta, sem derrubar o restante da árvore |
| RF5 | Sem nenhuma pasta aberta, a interface explica como abrir uma |
| RF6 | Caminho fora das raízes nunca é lido, mesmo por link simbólico |

## Requisitos não funcionais

- Núcleo (`src/core/files`) não importa Electron, React, `node:fs` nem `src/main` (Princípio IV).
- Toda pasta é medida em lotes de 64 `stat` para não estourar handles.
- Nomes ordenados naturalmente (`f2` antes de `f10`), pastas antes de arquivos.
- Comparação de caminho insensível a caixa só no Windows.

## Fora desta fatia (próxima)

- Editar e salvar (exige a exceção do Princípio II já registrada), abas, `Ctrl+P`, busca por conteúdo.
- Decoração de git por arquivo (adicionado/modificado/ignorado).
- Painel de editor dentro da grade unificada (fatia do `Pane`).

## Riscos

| Risco | Mitigação |
|---|---|
| Fuga por link simbólico ou junction | `realpath` antes da checagem + teste dedicado |
| Pasta gigante travando a interface | teto de 5.000 entradas, `stat` em lotes, `truncated` visível |
| Ler arquivo enorme por engano | teto de 5 MB por leitura, binário sem conteúdo |
| Escrita acidental no repositório do usuário | não existe caminho de escrita nesta fatia |

## Nota de processo

Nesta sessão a fatia foi implementada antes de a spec existir, ao contrário do que o Fluxo de
desenvolvimento pede (spec → plan → tasks → código). A spec foi escrita depois, descrevendo o que
foi entregue; as tasks não foram formalizadas. A próxima fatia deve seguir a ordem do Fluxo.
