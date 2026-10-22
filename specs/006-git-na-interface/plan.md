# Implementation Plan: Git na interface, no estilo do IntelliJ

**Branch**: `006-git-na-interface` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)

## Summary

Um `GitService` no núcleo, sobre o `GitRunner` existente (sem shell), oferece status estruturado,
commit dos arquivos escolhidos, fetch/pull/push com progresso e cancelamento, branches, merge com
conflitos e histórico. Operações são serializadas por repositório e rodam com
`GIT_TERMINAL_PROMPT=0` e `GIT_LITERAL_PATHSPECS=1`. Toda operação que pode perder trabalho volta
`needsConfirm` antes de agir. A interface ganha a barra de git por pasta, a janela de commit, o
seletor de branch, a lista de conflitos e o histórico. Constitution de referência: 2.0.0.

## Technical Context

**Language/Version**: TypeScript 5.9 estrito, Electron 44.9.2, Node 24; git 2.30+ do sistema

**Primary Dependencies**: React 19, CodeMirror 6 (editor existente) — **nenhuma nova**

**Storage**: nenhum estado novo; tudo vem do git

**Testing**: Vitest (unit com `FakeProcessRunner`; integração com repositórios reais e remoto `--bare`
local em pasta temporária; desempenho com 500 arquivos), Playwright

**Performance Goals**: janela de commit com 500 arquivos em < 2 s (SC-002)

**Constraints**: sem shell; sem guardar credenciais; sem force push, reset, rebase, stash; escrita no
repositório só por ação explícita, com confirmação nas que perdem trabalho (Princípio II)

## Constitution Check

| Princípio | Situação |
|---|---|
| I | ✅ Não envolve agentes. |
| II. Pasta do usuário com controle explícito | ✅ Operações só por ação explícita. Confirmação (`needsConfirm`) em tudo que pode perder trabalho: descartar (apagar arquivo novo / reverter alterado), trocar de branch com pendências, merge e pull com árvore suja, abortar merge (descarta resoluções), amend de commit publicado, push na principal. Credenciais delegadas ao git. Leituras com `--no-optional-locks`. Arquivo temporário da mensagem de commit em `os.tmpdir()`, nunca no repositório. Em falha de commit, o índice volta ao estado anterior. |
| III | ✅ Sessões não são afetadas; aviso quando há agente vivo no workspace. |
| IV. Núcleo independente | ✅ `src/core/git/` puro com portas; Electron só no main/renderer. |
| V/VI | ✅ Testes por história com repositórios reais; nenhuma decisão em aberto no plano. |
| VII. Sem surpresas | ✅ Sem dependência nova; canais IPC e códigos de erro novos aprovados — ver abaixo. |
| VIII. Execução segura | ✅ `git` com argumentos em lista, sem shell; `GIT_LITERAL_PATHSPECS=1` (caminho nunca vira pathspec mágico); `--end-of-options` antes de refs e `--` antes de caminhos; branch de `checkout`/`merge` precisa existir em `branches()`; nome de branch novo validado com `check-ref-format --branch` recusando `@{` ; `sha` `[0-9a-f]{7,64}`; credenciais em URLs mascaradas (`https://***@host`) em mensagens e logs. |

Resultado: **passa** (aprovações do Princípio VII registradas abaixo).

### Aprovações (Princípio VII)

| Contrato | Mudança | Aprovação |
|---|---|---|
| IPC | grupo `git` e evento `gitProgress` (contracts/ipc.md) | aprovado pelo dono em 2026-10-22 |
| Erros | códigos `GIT_AUTH`, `GIT_REJECTED`, `GIT_IDENTITY`, `GIT_HOOK_FAILED`, `GIT_LOCKED`, `GIT_FAILED` | aprovado pelo dono em 2026-10-22 |

## Design

### Núcleo (`src/core/git/`)

- `status-v2.ts` (puro): parser de `status --porcelain=v2 -z --branch --untracked-files=all`.
- `log-parse.ts` (puro): `log --format` com `\x1f`/`\x1e` e `--name-status -z`.
- `git-errors.ts` (puro): mapeia o stderr pela linha `fatal:`/`error:` (ignora avisos como
  `LF will be replaced`): credencial → `GIT_AUTH`; `[rejected]`/`fetch first` → `GIT_REJECTED`;
  identidade → `GIT_IDENTITY`; hook → `GIT_HOOK_FAILED` (saída do hook só para a interface);
  `index.lock` → `GIT_LOCKED` ("Outro processo do git está usando este repositório — talvez um agente.
  Tente de novo em instantes."); sem permissão → `GIT_FAILED` com a linha; mascara credenciais.
- `git-service.ts`: dependências `{ git, fs, log, mutex: KeyedMutex, clock, tmpdir }`; todas as
  chamadas com `GIT_LITERAL_PATHSPECS=1`; rede com `GIT_TERMINAL_PROMPT=0` (no Windows o Git
  Credential Manager pode abrir a janela própria, comportamento esperado; não definimos
  `GCM_INTERACTIVE`).
  - `status(repo)`: `RepoStatus` com `state` `normal | merging | rebasing | cherry-picking | detached`
    (lidos via `rev-parse --git-path` de `MERGE_HEAD`, `rebase-merge`, `rebase-apply`,
    `CHERRY_PICK_HEAD`), `mergeMessage` (de `MERGE_MSG`), `defaultRemoteBranch` (de
    `refs/remotes/<remote>/HEAD`, senão `main`, senão `master`), `lastFetchAt`.
  - `commit(repo, { paths, message, amend })`:
    - estado `merging` → exige **todos** os arquivos marcados; commit sem paths (`git commit -F`), pois
      o git recusa commit parcial durante merge;
    - senão → `git add -- <paths e oldPath dos renomeados>` e `git commit -F <tmp> -- <mesmos paths>`;
    - em falha (hook, identidade, lock) → `git restore --staged -- <paths que o app adicionou e não
      estavam no índice antes>`; o índice volta ao que estava;
    - amend: `paths` pode ser vazio (só mensagem); publicado = `merge-base --is-ancestor HEAD @{u}` →
      `needsConfirm: 'amend-published'`.
  - `discard(repo, paths)`: por `kind` — `untracked` → apagar arquivo (`needsConfirm: 'discard'` com
    ação "apagar"); `modified`/`deleted` → `restore --source=HEAD --staged --worktree`; `renamed` →
    restaura o antigo e apaga o novo; confirmação lista ação por arquivo.
  - `fetch | pull | push(repo, confirm, onProgress, signal)`: `--progress`; `pull --no-rebase`; pull e
    merge com árvore suja → `needsConfirm: 'merge-dirty'`; push sem upstream → `'set-upstream'`; push
    para `defaultRemoteBranch` → `'push-main'`; resultado final `{ conflicts?: string[] }`; cancelar mata
    o processo.
  - `branches`, `createBranch` (validado e cria a partir da atual), `checkout(branch)` (com pendências →
    `'checkout-dirty'`; branch remota sem local → cria a local com tracking), `merge(branch, confirm)`
    (`'merge-dirty'`), `abortMerge(confirm)` (`'abort-merge'`, descarta resoluções), `markResolved`.
  - Estados `rebasing`/`cherry-picking` iniciados fora do app: só exibidos, com a instrução para
    concluir fora; o app não aborta nem continua (FR-012).
  - `log(repo, skip)` (200 por página), `commitDiff(repo, sha, path)`.
- Diff de arquivo reaproveita `src/core/git/diff.ts`, que já marca binários; arquivos acima de 1 MB de
  diff aparecem como "grande demais para mostrar".
- `src/core/errors.ts`: códigos novos com mensagens padrão.

### Main/IPC

Grupo `git` ([contracts/ipc.md](contracts/ipc.md)). Operações de rede devolvem `opId` e emitem
**`gitProgress`** `{ opId, phase, percent?, done?, error?, result? }`; `cancel(opId)`. Confirmações:
chamar de novo com `confirm: [...]`. "Commit and Push" é do renderer: `commit` e, se der certo, `push`
(que pode pedir as próprias confirmações).

### Renderer

- `Git/GitBar.tsx`: por pasta git do workspace (feature 003), sob o workspace na árvore: branch (abre
  o seletor), ↑/↓, último fetch, estado (merge/rebase/cherry-pick/detached), botões com progresso e
  cancelar. Relê o status quando a janela ganha foco e após cada operação (sem polling).
- `Git/CommitDialog.tsx`: lista agrupada com caixas, diff ao lado (reaproveita `DiffView`), mensagem
  (preenchida com `mergeMessage` em merge), Amend, "Commit", "Commit and Push", "Descartar" por
  arquivo. Aviso de agente vivo a partir do snapshot (execuções `running`/`idle`/`starting` cujas
  tarefas são do workspace).
- `Git/BranchPicker.tsx`, `Git/ConflictList.tsx` (abrir no editor existente, marcar resolvido,
  abortar com confirmação), `Git/HistoryView.tsx`, `Git/ConfirmGitDialog.tsx` (texto por tipo de
  confirmação).

### Logs

`git.op { op, repoId, ok, code?, durationMs }` — sem mensagem de commit, conteúdo, saída de hook nem
URL com credencial.

## Estratégia de testes

| Camada | Cobre | Onde |
|---|---|---|
| Unit core | parsers, mapeamento de erros (linha `fatal:`/`error:`, aviso de CRLF ignorado, `index.lock`, mascaramento), validações | `tests/unit/core/git/` |
| Integração | commit (parcial, renomeado, merge, falha restaura índice), amend, discard por tipo, rede com remoto `--bare`, confirmações, conflito, estados externos, cancelamento, credencial ausente, lock, pathspec literal, desempenho com 500 arquivos | `tests/integration/core/git/` (um arquivo por tema) |
| Unit main | canais, validação, confirmações | `tests/unit/main/ipc/register-git.test.ts` |
| Unit renderer | barra, janela de commit, Commit and Push, seletor, conflitos, histórico, confirmações | `tests/unit/renderer/Git*.test.tsx` |
| e2e | commit parcial e push para remoto local | `tests/e2e/git.spec.ts` |

### Roteiro de tela (para o `/testar-tela`)

- **US1**: abrir a janela de commit → todos marcados e agrupados → desmarcar um → ver diff de outro →
  mensagem → Commit → o desmarcado continua na lista; ↑1 na barra.
- **US2**: push numa branch de feature → ↑0; push na main → confirmação; pull com commit no remoto → ↓
  some; remoto sem credencial → mensagem, sem travar; cancelar um fetch longo.
- **US3**: criar branch, commitar, voltar, mesclar; repetir com conflito → lista, abrir no editor,
  marcar resolvido, concluir → janela de commit com mensagem de merge; abortar pede confirmação.
- **US4**: histórico → commit → arquivo → diff.

Detalhe em [quickstart.md](quickstart.md).

## Project Structure

```text
src/core/git/status-v2.ts, log-parse.ts, git-errors.ts, git-service.ts (novos); src/core/errors.ts
src/shared/ipc-contract.ts
src/main/ipc/register-git.ts, validate-git.ts (novos), src/main/ipc/register.ts, src/main/main.ts
src/renderer/components/Git/GitBar.tsx, CommitDialog.tsx, BranchPicker.tsx, ConflictList.tsx, HistoryView.tsx, ConfirmGitDialog.tsx (novos)
src/renderer/components/Tree/TreeGroup.tsx, src/renderer/App.tsx
```

## Complexity Tracking

Sem violações.
