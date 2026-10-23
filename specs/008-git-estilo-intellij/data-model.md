# Data Model: Interface de git no estilo do IntelliJ

Nada novo no disco do app. Tipos do renderer:

## Preferências (localStorage)

| Chave | Valor | Padrão |
|---|---|---|
| `melinna.sidebarPanel` | `'workspaces' \| 'files' \| 'commit'` | `'workspaces'` |
| `melinna.activeWorkspace` | id do workspace | o primeiro da lista |

## RepoView

`{ folderId, root, name, status: RepoStatus (006), op: { opId, kind, phase, percent } | null, error: string | null }`

## Seleção

`Map<root, Set<path>>`. Inicial: alterados marcados, não rastreados desmarcados. Ao reler: mantém os
caminhos que continuam alterados; os novos seguem a regra inicial.

## Nó da árvore

`{ id, kind: 'group' | 'repo' | 'dir' | 'file', label, root, path?, change?: Change, children }`;
estado da caixa: `checked | unchecked | partial`.

## Resultado de sequência

`{ root, outcome: 'ok' | 'skipped' | 'error', sha?, message? }` por repositório.
