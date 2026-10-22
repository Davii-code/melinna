# Contrato IPC: Git na interface

Novo grupo `git` na `MelinnaApi`; todos devolvem `Result<T>`. `repo` é a raiz de uma pasta de
workspace aberta (validada contra as raízes registradas).

```ts
type Confirm = 'amend-published' | 'push-main' | 'checkout-dirty' | 'discard' | 'set-upstream' | 'merge-dirty' | 'abort-merge';
interface NeedsConfirm {
  needsConfirm: Confirm;
  details: { files?: { path: string; action?: 'apagar' | 'reverter' }[]; branch?: string; remote?: string };
}
type OpStarted = { opId: string };

git: {
  status(repo: string): Promise<Result<RepoStatus>>;
  diffFile(repo: string, path: string): Promise<Result<FileDiff>>;
  /** paths pode ser vazio só com amend; em merge, exige todos os arquivos. */
  commit(repo: string, input: { paths: string[]; message: string; amend: boolean; confirm?: Confirm[] }): Promise<Result<{ sha: string } | NeedsConfirm>>;
  discard(repo: string, paths: string[], confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
  fetch(repo: string): Promise<Result<OpStarted>>;
  pull(repo: string, confirm?: Confirm[]): Promise<Result<OpStarted | NeedsConfirm>>;
  push(repo: string, confirm?: Confirm[]): Promise<Result<OpStarted | NeedsConfirm>>;
  cancel(opId: string): Promise<Result<void>>;
  branches(repo: string): Promise<Result<Branch[]>>;
  createBranch(repo: string, name: string): Promise<Result<void>>;
  checkout(repo: string, branch: string, confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
  merge(repo: string, branch: string, confirm?: Confirm[]): Promise<Result<{ conflicts: string[] } | NeedsConfirm>>;
  abortMerge(repo: string, confirm?: Confirm[]): Promise<Result<void | NeedsConfirm>>;
  markResolved(repo: string, paths: string[]): Promise<Result<void>>;
  log(repo: string, skip: number): Promise<Result<Commit[]>>;            // 200 por página
  commitDiff(repo: string, sha: string, path: string): Promise<Result<FileDiff>>;
  /** Evento gitProgress: progresso e fim das operações de rede. */
  onProgress(fn: (e: { opId: string; phase: string; percent?: number; done?: boolean; error?: IpcError; result?: { conflicts?: string[] } }) => void): Unsubscribe;
}
```

`FileDiff` é o tipo já existente em `src/core/api-types.ts` (usado pelo `DiffView`).

"Commit and Push" não é um canal: o renderer chama `commit` e, se der certo, `push`.

## Validação (main)

| Campo | Regra |
|---|---|
| `repo` | raiz registrada de um workspace aberto |
| `paths` | 0–5.000 (0 só em `commit` com `amend`); relativos, sem `..`, sem começar com `-`, sem caracteres de controle, dentro do repo; tratados como literais (`GIT_LITERAL_PATHSPECS=1`) |
| `message` | 1–20.000 caracteres |
| `name` (branch nova) | `git check-ref-format --branch`, sem `@{`, sem começar com `-` |
| `branch` (checkout/merge) | precisa existir em `branches(repo)` |
| `sha` | `[0-9a-f]{7,64}` |

## Erros

| Código | Mensagem padrão |
|---|---|
| `GIT_AUTH` | "O git não conseguiu se autenticar no remoto. Configure suas credenciais (Git Credential Manager ou SSH) e tente de novo." |
| `GIT_REJECTED` | "O remoto recusou o envio porque tem commits novos. Faça pull antes." |
| `GIT_IDENTITY` | "Configure seu nome e e-mail no git (git config user.name / user.email)." |
| `GIT_HOOK_FAILED` | "Um hook do git recusou a operação." + saída do hook (só na interface) |
| `GIT_LOCKED` | "Outro processo do git está usando este repositório — talvez um agente. Tente de novo em instantes." |
| `GIT_FAILED` | linha `fatal:`/`error:` do git, com credenciais mascaradas |
| `INPUT_INVALID` | nome de branch inválido, lista vazia sem amend, mensagem vazia, commit parcial durante merge ("Durante um merge, todos os arquivos entram no commit.") |
