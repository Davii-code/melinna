# Plan — Feature 002, fatia 2 (painel unificado + editor)

## Dependências (lista fechada, Princípio VII)

Aprovadas com a recomendação de arquitetura (CodeMirror 6, MIT), versões exatas gravadas no
`package.json` sem `^`:

| Pacote | Versão | Papel |
|---|---|---|
| `@codemirror/state` | 6.7.6 | estado do documento, efeitos, transações |
| `@codemirror/view` | 6.43.15 | `EditorView`, gutter de linhas, realce da linha ativa |
| `@codemirror/commands` | 6.11.1 | histórico, keymaps padrão |
| `@codemirror/language` | 6.13.1 | realce sintático, dobra, indentação |
| `@codemirror/search` | 6.7.2 | busca dentro do arquivo |
| `@codemirror/lang-javascript` | 6.2.5 | ts/tsx/js/jsx (via `javascript({typescript, jsx})`) |
| `@codemirror/lang-json` | 6.0.2 | json |
| `@codemirror/lang-markdown` | 6.5.2 | md/mdx |
| `@codemirror/lang-css` | 6.3.1 | css |
| `@codemirror/lang-html` | 6.4.12 | html |

Nenhuma dependência de estado, de layout ou de arrastar e soltar é adicionada: o que existe é
código próprio e continua assim.

## Modelo de painéis

```ts
export type Pane =
  | { id: string; kind: 'executions'; execIds: string[]; activeIndex: number }
  | { id: string; kind: 'editor'; docs: string[]; activeIndex: number };

export interface LayoutState {
  mode: LayoutMode;
  panes: Pane[];
  focusedPaneId: string | null;
  custom: CustomGrid;
}
```

Decisões:

1. **Painel de terminal usa `id === execId` da primeira execução.** Assim a migração de v1 é
   literal: cada id de `openExecutionIds` vira um painel cujo id é o próprio execId, e as chaves de
   `CustomGrid.cells` continuam válidas. Nada na grade, nas divisórias ou no arrastar precisa mudar.
2. **Um xterm por painel, sempre o da aba ativa.** Trocar de aba desmonta o `TerminalView` atual e
   monta o seguinte; o `MessagePort` é refeito e o host reproduz o scrollback. Custa disco, não
   memória — e é o que permite dezenas de PTYs vivos.
3. **Editor guarda caminhos, não conteúdo.** O texto vive no `EditorState` do CodeMirror (memória);
   o que persiste é `docs[]` e `activeIndex`. Rascunho em disco fica para a fatia de robustez.
4. **Escrita atômica com hash.** `files.write(path, content, expectedHash)`: lê o arquivo, compara o
   SHA-256 com o hash que o editor recebeu na leitura; divergência é `FILE_CONFLICT`; senão grava em
   `<arquivo>.tmp-<n>` e renomeia, devolvendo o hash novo.
5. **`Ctrl+P` sem IPC novo.** O índice de arquivos é montado no renderer pela própria
   `files.list`, em largura, com teto de 2.000 arquivos e poda de `node_modules`, `.git`, `out`,
   `dist`, `coverage`. Se o teto estourar, a interface diz que a lista está incompleta.

## Migração de esquema

`STATE_SCHEMA_VERSION` 1 → 2 em `src/core/persistence/state-schema.ts`. `parseState` aceita 1 e 2 e
devolve sempre v2:

- v1: `openExecutionIds: string[]` + `focusedExecutionId` → `panes` (um por id, `kind: 'executions'`,
  `execIds: [id]`, `activeIndex: 0`) e `focusedPaneId` (o antigo, se ainda existir; senão o primeiro).
- v2: validado campo a campo; painel inválido é descartado, não derruba o estado inteiro.
- `parseState` nunca escreve: a gravação seguinte já sai em v2.

## Fatias de execução

| # | Entrega |
|---|---|
| T1 | `Pane` + migração v2 + testes de esquema |
| T2 | `layout-store` com painéis (abrir/fechar/focar/reordenar/prune) + testes |
| T3 | `files.write` com hash e conflito + IPC + testes |
| T4 | Painel de terminal com abas + App/Grid usando painéis |
| T5 | `EditorPane` (CodeMirror, abas, sujo, salvar) + testes |
| T6 | `Ctrl+P` (índice + modal) + `Ctrl+S`/`Ctrl+W` + testes |

## Riscos

| Risco | Mitigação |
|---|---|
| Refatorar o layout quebrar a grade que funciona | id do painel de terminal = execId; grade/divisórias intocadas |
| Perda de edição ao fechar aba | confirmação em aba suja; conflito de disco recusado |
| Sobrescrever mudança feita por um agente | hash obrigatório na escrita; `FILE_CONFLICT` |
| Índice de `Ctrl+P` varrer `node_modules` | poda por nome de pasta + teto de arquivos |
