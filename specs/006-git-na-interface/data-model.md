# Data Model: Git na interface

Nada é persistido pelo app; os tipos abaixo são lidos do git a cada consulta.

## RepoStatus

| Campo | Tipo | Origem |
|---|---|---|
| `root` | string | pasta do workspace |
| `branch` | string \| null | `# branch.head` (null = detached) |
| `head` | string | `# branch.oid` |
| `upstream` | string \| null | `# branch.upstream` |
| `ahead`, `behind` | number \| null | `# branch.ab` (null sem upstream) |
| `state` | `'normal' \| 'merging' \| 'rebasing' \| 'cherry-picking' \| 'detached'` | `rev-parse --git-path` de `MERGE_HEAD`, `rebase-merge`/`rebase-apply`, `CHERRY_PICK_HEAD`; `branch.head` |
| `mergeMessage` | string \| null | conteúdo de `MERGE_MSG` em `merging` |
| `changes` | `Change[]` | linhas `1`, `2`, `u`, `?` de `status --porcelain=v2 -z --branch --untracked-files=all` |
| `hasRemote` | boolean | `git remote` |
| `defaultRemoteBranch` | string \| null | `refs/remotes/<remote>/HEAD`; senão `main`; senão `master` |
| `lastFetchAt` | ISO \| null | mtime de `FETCH_HEAD` (caminho via `rev-parse --git-path FETCH_HEAD`) |

## Change

| Campo | Tipo |
|---|---|
| `path` | string relativo à raiz |
| `oldPath` | string? (renomeado) |
| `kind` | `'modified' \| 'added' \| 'deleted' \| 'renamed' \| 'untracked' \| 'conflict'` |
| `indexChanged`, `worktreeChanged` | boolean (informativos; o commit usa a seleção da janela) |

Descartar por `kind`: `untracked` → apagar; `modified`/`deleted`/`added` → reverter ao HEAD (para
`added` no índice: tirar do índice e apagar, com confirmação "apagar"); `renamed` → restaurar o antigo e
apagar o novo.

## Branch

`{ name, kind: 'local' | 'remote', current, upstream?: string }`

## Commit

`{ sha, shortSha, author, email, date (ISO), subject, body, files: { path, oldPath?, kind }[] }`

## FileDiff

Tipo existente em `src/core/api-types.ts`; binário marcado; diff acima de 1 MB vem como "grande demais".

## Operação longa

`{ opId, kind: 'fetch' | 'pull' | 'push', repo, startedAt }`; evento `gitProgress`
`{ opId, phase, percent?, done?, error?, result?: { conflicts?: string[] } }`.

## Confirmações

`'amend-published' | 'push-main' | 'checkout-dirty' | 'discard' | 'set-upstream' | 'merge-dirty' | 'abort-merge'`,
com `details` (arquivos e ação por arquivo, branch, remoto).
