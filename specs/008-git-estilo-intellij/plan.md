# Implementation Plan: Interface de git no estilo do IntelliJ

**Branch**: `008-git-estilo-intellij` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

## Summary

Troca a forma de usar o git da 006 pelo modelo do IntelliJ, só no renderer: uma barra de ferramentas
vertical (`ToolStrip`) que escolhe o painel lateral (Workspaces, Arquivos, Commit), um painel de
Commit fixo com a árvore "Changes"/"Unversioned Files" agrupada por repositório do workspace ativo, e a
barra superior com o seletor do workspace ativo e o seletor de branch (com fetch/pull/push, branches e
histórico). O núcleo `GitService` e os 16 canais `git:*` da 006 não mudam; commit e push em vários
repositórios são sequências de chamadas aos canais existentes. A barra de git sob o workspace e o
diálogo de commit da 006 saem. Constitution de referência: 2.0.0.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24

**Primary Dependencies**: React 19, CodeMirror 6 (editor existente) — **nenhuma nova**

**Storage**: preferências da interface em `localStorage` do renderer, no mesmo padrão de
`storedSidebarWidth`/`storedSidebarCollapsed` (`SidebarResizer.tsx`): painel lateral escolhido e id do
workspace ativo. Nenhum estado novo no disco do app, nenhum campo novo no `LayoutState`.

**Testing**: Vitest + Testing Library (unit do renderer com `fakeApi`), Playwright (e2e com remoto
`--bare` local)

**Target Platform**: Windows 10 1809+ validado; Linux/macOS compilam

**Performance Goals**: painel com 3 repositórios e 500 arquivos em < 2 s (SC-001); marcar/desmarcar um
grupo de 500 arquivos em < 200 ms (SC-004)

**Constraints**: sem dependência nova; sem canal de IPC novo; sem leitura periódica (relê no foco e ao
fim das operações); as regras da 006 continuam (confirmações, credenciais com o git, aviso de agente)

**Scale/Scope**: até 10 workspaces, até 5 pastas git por workspace, até 5.000 arquivos alterados por
repositório (limite de caminhos da 006)

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Não envolve agentes. |
| II. Pasta do usuário com controle explícito | ✅ Toda escrita continua nos canais da 006 por ação explícita; reverter usa `git.discard` com a confirmação por arquivo; amend publicado, push na principal, troca com pendências e abortar merge mantêm as confirmações. Commit em vários repositórios é uma sequência explícita, sem desfazer o que já foi feito. |
| III | ✅ Sessões não são afetadas; aviso de agente vivo no painel. |
| IV. Núcleo independente | ✅ Mudança só em `src/renderer`; o núcleo não muda. |
| V/VI | ✅ Testes por história escritos antes; nenhuma decisão em aberto. |
| VII. Sem surpresas | ✅ Sem dependência, sem canal de IPC, sem mudança no estado em disco ou no esquema. Preferências de interface em `localStorage`, como a largura da barra lateral já faz. |
| VIII | ✅ Não lança processos novos. |
| IX/X | ✅ O IntelliJ é referência de uso (organização de tela), não a referência AGPL tratada no Princípio IX. Ícones desenhados no próprio projeto (SVG inline com a paleta Melinna); nenhum asset do IntelliJ. Os rótulos em inglês ("Changes", "Commit and Push…") são palavras comuns, não marca. |

Resultado: **passa**.

## Design

### Estado do renderer

- `src/renderer/git/git-store.ts` (novo, sem React): estado por repositório do workspace ativo — status
  (da 006), seleção (`Set` de caminhos por repo), operação de rede em curso (`opId`, fase, %), último erro.
  Funções puras para a árvore e a seleção, testáveis sem DOM:
  - `buildChangeTree(repos)` → nós `group` ("Changes", "Unversioned Files") → `repo` → `dir` → `file`.
    "Changes" = `kind !== 'untracked'`; "Unversioned Files" = `untracked`.
  - `toggle(node, selection)` e `checkState(node, selection)` (`checked | unchecked | partial`).
  - `initialSelection(status)` (alterados marcados, não rastreados desmarcados) e
    `mergeSelection(prev, status)` (mantém as marcas dos caminhos que continuam alterados; caminhos novos
    entram pela regra inicial).
  - `planCommit(repos, selection)` → lista `{ repo, paths }` só dos repos com marcados; repo em merge exige
    todos os caminhos dele (regra da 006) e é recusado antes de chamar o IPC com a mensagem da 006.
- `src/renderer/git/git-workspace.tsx` (`GitWorkspaceProvider` + hook `useGitWorkspace`): uma única instância, compartilhada por contexto entre o painel Commit, o menu da branch e o selo da barra vertical (uma só leitura por foco). Expõe `busy` durante uma sequência, e o seletor de workspace fica desabilitado enquanto isso. O provider carrega o status de cada pasta do workspace ativo em
  paralelo (`api.git.status`), ignora `REPO_INVALID` (pasta sem git) e pastas indisponíveis, relê no
  `focus` da janela e ao fim de cada operação (evento `gitProgress` com `done`), adota operações pelo
  `opId` com o buffer de eventos antecipados que a `GitBar` da 006 já usa (movido para cá).
  Lê `localStorage` sempre com `try/catch`: valor inválido ou storage indisponível cai no padrão.
- `src/renderer/git/sequence.ts` (puro, recebe a API): `commitAll(plan, message, amend)` e
  `pushAll(repos)`/`fetchAll`/`pullAll` em sequência; devolve resultado por repositório
  (`ok | needsConfirm | error`). Os commits
  param no primeiro erro para o usuário corrigir (hook, identidade) antes de continuar, e os já feitos
  ficam; o painel lista "commitado" e "falhou: <motivo>" por repositório. `commitAndPush` só inicia
  pushes quando todos os commits deram certo. Pushes: um por vez; cada
  `needsConfirm` pausa a fila até a resposta; recusar pula aquele repositório e segue.

### Componentes

- `Layout/ToolStrip.tsx`: faixa vertical, montada já na fase de fundação (acesso mínimo ao painel Commit) e completada na US3; ícones de cima (Workspaces, Arquivos, Commit com selo de
  quantidade) e de baixo (Biblioteca de prompts, Catálogo). Clicar no ativo recolhe a barra lateral
  (`storedSidebarCollapsed`). Painel escolhido em `localStorage` (`melinna.sidebarPanel`). Substitui as
  abas "Workspaces"/"Arquivos" do cabeçalho da barra lateral e o `SidebarRail`.
- `Git/CommitPanel.tsx`: painel lateral. Barra de ações (Atualizar, Reverter, Ver diff, Expandir tudo,
  Recolher tudo), aviso de agente vivo, árvore (`Git/ChangeTree.tsx`, lista virtual simples por janela de
  linhas visíveis para 5.000 nós), área de conflitos por repo em merge (reaproveita a lógica da
  `ConflictList` da 006, agora embutida), caixa Amend (com escolha de repositório quando necessário),
  mensagem, "Commit" e "Commit and Push…". Resultado por repositório na própria área de mensagem.
- `Git/DiffPane.tsx`: o diff do arquivo clicado na área principal, sobre a grade, com "Fechar diff" e o
  caminho no título; não entra no `LayoutState` (não é persistido). Reaproveita `FileSection` do
  `DiffView`. Duplo clique na árvore abre o arquivo no editor (`layoutStore.openDoc`).
- `WorkspaceSwitcher.tsx`: seletor do workspace ativo com o ícone de iniciais na cor da faixa do
  workspace; id em `localStorage` (`melinna.activeWorkspace`); se sumir, o próximo da lista.
- `Git/BranchMenu.tsx`: botão com a branch do repositório principal (ou "HEAD solto em <sha>", ou "Sem
  git" desabilitado), ↑/↓ e "+N" quando há outros repos. Menu: topo com "Fetch todos"/"Pull todos" quando
  há mais de um repo; por repositório, cabeçalho com nome, branch e ↑/↓, e as ações "Nova branch…",
  branches locais/remotas com "Trocar"/"Mesclar na atual", "Fetch", "Pull", "Push…", "Histórico".
  Reaproveita a lógica da `BranchPicker` e a `HistoryView` da 006. Progresso e "Cancelar" ficam ao lado
  do botão. Estados de rebase/cherry-pick desabilitam trocar/mesclar/pull com a instrução.
- Removidos: `Git/GitBar.tsx`, `Git/CommitDialog.tsx` e a montagem da barra em `Tree/TreeGroup.tsx`.
  `ConfirmGitDialog`, `HistoryView`, `git-ui.ts` e `FileSection` continuam.

### Atalhos

O ícone Commit abre com **Alt+0** (o do IntelliJ); Workspaces **Alt+1**, Arquivos **Alt+2**. Ficam no
mesmo listener de janela que já trata Ctrl+P/Ctrl+Shift+P, mas **são ignorados quando o foco está no
terminal**: readline e zsh usam Alt+dígito como argumento numérico, e a tecla segue para o PTY. Com o
terminal em foco, o usuário troca de painel pelos ícones. (A 007 transforma esses atalhos em mapa
escolhível.)

### Erros e logs

Erros vêm dos canais da 006 (`Result`), mostrados por repositório no painel ou no menu, com a mensagem
pt-BR do principal. A interface não escreve log próprio: cada passo de uma sequência é uma chamada a
um canal da 006, e o principal registra `git.op { op, repoId, ok, code, durationMs }` por chamada, o que
já identifica qual repositório falhou. Uma operação agregada no principal não traria diagnóstico novo.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit puro | árvore, seleção (parcial, inicial, merge com releitura), plano de commit (regra de merge), sequências (para no erro do commit, fila de pushes com confirmação e recusa) | `tests/unit/renderer/git/*.test.ts` |
| Unit componentes | ToolStrip, CommitPanel (ações, commit, merge), DiffPane, WorkspaceSwitcher, BranchMenu (branches, rede), atalhos Alt+0/1/2 fora do terminal, cobertura dos 16 canais | `tests/unit/renderer/*.test.tsx` |
| Desempenho | árvore de 500 arquivos: montar e marcar grupo < 200 ms | `tests/perf/change-tree.test.ts` |
| e2e | workspace de 2 pastas git, commit de 1 arquivo em cada pelo painel, push pelo menu da branch para remotos `--bare` | `tests/e2e/git-intellij.spec.ts` |

Os testes da 006 de `GitBar` e `CommitDialog` saem junto com os componentes removidos; os cenários
deles que continuam valendo (confirmações, Commit and Push, aviso de agente, erro de autenticação,
foco relendo o status) são reescritos para o `CommitPanel` e o `BranchMenu`.

### Roteiro de tela (para o `/testar-tela`)

- **US1**: workspace de 2 pastas git → ícone Commit → "Changes" com as duas pastas e as branches →
  "Unversioned Files" desmarcado → marcar 1 arquivo de cada → clicar num arquivo e ver o diff ao lado →
  mensagem → Commit → os dois repos ganham commit; Commit and Push… pede a confirmação da main.
- **US2**: seletor de workspace troca o painel; menu da branch mostra os 2 repos; Nova branch; Push…
  com progresso e Cancelar; Histórico.
- **US3**: alternar painéis pelos ícones e por Alt+0/1/2; clicar no ativo recolhe; reabrir o app volta
  igual.

## Project Structure

```text
src/renderer/git/git-store.ts, git-workspace.tsx, sequence.ts (novos)
src/renderer/components/Layout/ToolStrip.tsx (novo)
src/renderer/components/Git/CommitPanel.tsx, CommitMessage.tsx, MergeConflicts.tsx, ChangeTree.tsx, DiffPane.tsx, BranchMenu.tsx, NetworkActions.tsx (novos)
src/renderer/components/WorkspaceSwitcher.tsx, Git/BranchMenu.tsx (novos)
src/renderer/components/TopBar.tsx, App.tsx, Tree/TreeGroup.tsx, styles/app.css (alterados)
src/renderer/components/Git/GitBar.tsx, CommitDialog.tsx (removidos), BranchPicker.tsx, ConflictList.tsx (lógica absorvida)
```

## Complexity Tracking

Sem violações.
