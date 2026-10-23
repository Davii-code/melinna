# Contrato: Interface de git no estilo do IntelliJ

**IPC**: nenhum canal novo. Usa os 16 canais `git:*` e o evento `gitProgress` da 006 sem alteração.

**Estado em disco**: nenhum campo novo.

## Componentes (props públicas)

```ts
ToolStrip: { panel: 'workspaces' | 'files' | 'commit'; collapsed: boolean; changes: number;
  onSelect(panel): void; onPrompts(): void; onCatalog(): void }
GitWorkspaceProvider: { workspace: Group | null; availability: Record<string, boolean>; children }
CommitPanel: { liveAgents: number; onOpenFile(path: string): void; onShowDiff(root: string, path: string): void }
DiffPane: { root: string; path: string; onClose(): void }
WorkspaceSwitcher: { groups: Group[]; activeId: string | null; onSelect(id: string): void }
BranchMenu: { onConflicts(root: string): void }   // estado vem de useGitWorkspace()
```

## Onde cada canal da 006 é usado

| Canal / evento | Ponto de acesso |
|---|---|
| `status` | painel Commit, menu da branch, selo da barra vertical (provider) |
| `diffFile` | clique no arquivo / "Ver diff" → `DiffPane` |
| `commit` | "Commit" / "Commit and Push…" (um por repositório) |
| `discard` | "Reverter" na barra de ações |
| `fetch`, `pull`, `push`, `cancel` | menu da branch (por repo e "todos"), "Commit and Push…", "Cancelar" na barra superior |
| `branches`, `createBranch`, `checkout`, `merge` | menu da branch |
| `abortMerge`, `markResolved` | conflitos do repositório no painel Commit |
| `log` | "Histórico" no menu da branch; Amend (última mensagem) |
| `commitDiff` | arquivo de um commit na `HistoryView` |
| evento `gitProgress` | progresso e fim das operações de rede (provider) |

Estados de rebase, cherry-pick e HEAD solto vêm do `status` e aparecem no menu da branch.

## Rótulos acessíveis (usados nos testes)

- Barra vertical: `Workspaces (Alt+1)`, `Arquivos (Alt+2)`, `Commit (Alt+0)` (atalhos fora do terminal), `Biblioteca de prompts`, `Catálogo de agentes`.
- Painel: árvore `role="tree"` com nós `role="treeitem"`; caixas `Selecionar <nome>`; ações `Atualizar`, `Reverter`, `Ver diff`, `Expandir tudo`, `Recolher tudo`; `Amend`, `Mensagem do commit`, `Commit`, `Commit and Push…`.
- Barra superior: `Workspace ativo`, `Branch <nome>`, itens de menu `Nova branch…`, `Fetch`, `Pull`, `Push…`, `Histórico`, `Fetch todos`, `Pull todos`, `Cancelar`.
