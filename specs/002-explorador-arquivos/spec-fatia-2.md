# Feature 002 — fatia 2: painel unificado e editor de código

Depende da fatia 1 (`files.list/read`, já entregue). Esta spec descreve o modelo de painéis e o
editor; a depsnova lista e as decisões técnicas ficam em `plan.md`.

## Problema

Hoje a superfície do app é uma grade plana de execuções: `LayoutState.openExecutionIds` é uma lista
de ids de execução e cada célula da grade é um terminal. Não há como colocar um arquivo ao lado dos
terminais, e o modelo persistido não conhece outro tipo de conteúdo.

## Objetivo

Uma única grade de painéis em que cada célula pode ser **terminal (com abas de execução)** ou
**editor (com abas de arquivo)**, mantendo os quatro modos de layout e a grade personalizada, e
sobrevivendo a reinício com migração de esquema.

## Requisitos funcionais

| # | Requisito |
|---|---|
| RF1 | O layout persistido passa a ser uma lista de painéis tipados; o esquema é migrado de 1 para 2 sem perder painéis abertos, foco, modo nem células da grade personalizada |
| RF2 | Abrir uma execução que já está aberta só a foca; abrir uma nova cria um painel de terminal |
| RF3 | Um painel de terminal mostra uma aba por execução e só monta o xterm da aba ativa; trocar de aba reanexa ao PTY e reproduz o scrollback |
| RF4 | Fechar uma aba de execução remove a execução do painel; fechar a última aba remove o painel |
| RF5 | O explorador abre um arquivo num painel de editor; se já houver um painel de editor em foco, o arquivo entra nele como nova aba |
| RF6 | O editor mostra número de linha, realce por extensão, busca e atalhos, e marca a aba como suja ao editar |
| RF7 | Salvar grava o arquivo e limpa a marca de sujo; se o arquivo mudou em disco desde a abertura, o salvamento é recusado com conflito (nunca sobrescreve em silêncio) |
| RF8 | Fechar uma aba suja pede confirmação e descarta a edição se o usuário confirmar |
| RF9 | `Ctrl+P` abre o "ir para arquivo" da raiz ativa, com filtro por nome e caminho |
| RF10 | `Ctrl+S` salva a aba ativa; `Ctrl+W` fecha a aba ativa |

## Requisitos não funcionais

- O núcleo continua sem Electron/React/node-pty (Princípio IV); o modelo de painéis é puro e
  testado em `src/core`.
- A escrita em disco passa pela exceção registrada no Princípio II: só por ação explícita, com hash
  antes/depois no log, conflito recusado e nada de autosave.
- Nenhuma alteração de comportamento de PTY: um painel com abas mantém os PTYs vivos no hospedeiro;
  trocar de aba apenas desanexa a interface.
- Migração é idempotente e testada nos dois sentidos (v1 → v2 e v2 relido).

## Fora desta fatia

- Rascunho em disco para recuperação após queda (fica para a fatia de robustez do editor).
- Busca por conteúdo em arquivos (`rg`) e LSP/autocomplete.
- Painéis de preview de imagem/vídeo e de diff dentro da grade (o diff continua em modal).
