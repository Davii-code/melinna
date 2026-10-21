# Plano — explorador de arquivos + editor + terminais simultâneos

Complemento de `docs/analise-referencia-alethe.md`. Descreve a arquitetura do diferencial pedido:
**ver os arquivos do projeto como no VS Code/IntelliJ e, ao mesmo tempo, operar vários terminais**.

Nada aqui depende de código do Alethe: os padrões de layout (árvore à esquerda, abas, grade de
painéis, inspetor à direita) são de mercado. O delta é nosso.

---

## 1. O que muda no produto

Hoje o Melinna tem **uma** superfície: a grade de execuções. O usuário abre agentes e vê terminais.

Depois desta fatia, a janela passa a ter **quatro regiões**:

```
┌──────┬──────────────┬──────────────────────────────────────┬───────────┐
│ rail │ explorador   │ área principal (grade de painéis)    │ inspetor  │
│ 48px │ 240–420px    │ painéis: terminal | editor | diff |  │ 320px     │
│      │ (redimension)│ preview | quadro                     │ (opcional)│
└──────┴──────────────┴──────────────────────────────────────┴───────────┘
```

- **rail** de atividades (48px): Workspaces | Arquivos | Busca | Git | Quadro.
- **explorador**: árvore do workspace com decoração de git e menu de contexto.
- **área principal**: continua sendo a grade que já existe (auto/spotlight/sidebar/custom), só que
  cada célula pode ser um painel de tipo diferente.
- **inspetor**: detalhes da seleção (execução, arquivo, diff, tarefa).

O terminal **não** vira uma gaveta separada: ele é um tipo de painel. Assim o usuário monta o arranjo
que quiser — editor à esquerda + dois terminais à direita, editor em cima + terminal embaixo com uma
divisória arrastável, quatro terminais em grade, etc. Um único motor de layout serve os dois mundos.

---

## 2. Modelo de dados

### 2.1 Painel como união discriminada (substitui `openExecutionIds: string[]`)

```ts
export type PaneKind =
  | { kind: 'executions'; execIds: string[]; activeIndex: number }  // 1..N terminais em abas
  | { kind: 'editor'; docs: EditorDoc[]; activeIndex: number }       // 1..N arquivos em abas
  | { kind: 'diff'; execId: string }
  | { kind: 'preview'; path: string; mode: 'image' | 'video' | 'pdf' | 'text' }
  | { kind: 'board'; groupId: string };                              // fase de orquestração

export interface Pane {
  id: string;                 // chave estável; é a mesma chave usada em CustomGrid.cells
  kind: PaneKind;
  title: string;              // rótulo da aba do container
}

export interface EditorDoc {
  path: string;               // absoluto, dentro de um workspace
  dirty: boolean;
  /** Se o arquivo estiver sujo ao fechar o app, o conteúdo vai para drafts/ e é restaurado. */
  draftPath?: string;
  scrollTop?: number;
  caret?: { line: number; col: number };
  /** Para reabrir no lugar certo depois de recarregar. */
  pinned?: boolean;
}
```

`LayoutState` passa a `{ mode, panes: Pane[], focusedPaneId, custom }`, com `CustomGrid.cells`
chaveado por `Pane.id`. **Migração de esquema: `STATE_SCHEMA_VERSION` 1 → 2**, com função de
backfill que transforma cada id de `openExecutionIds` em um `Pane` de `kind: 'executions'` com um
único `execId`. A constituição exige manter a migração; o teste de migração entra junto.

### 2.2 Por que "executions" no plural
Uma sub-aba de terminal é exatamente uma execução (PTY próprio). O host já suporta N PTYs; a
interface é que hoje assume 1 painel = 1 execução. Unificar em `execIds` entrega de graça:
- sub-abas por painel (Claude + Codex + shell no mesmo painel);
- "trocar de agente sem perder o anterior";
- fechar uma aba sem matar o PTY (o processo continua no host, o painel só desanexa).

Atenção a uma diferença de semântica: no Melinna cada execução pertence a uma **tarefa** e a um
**worktree**. Logo, um painel com duas execuções de tarefas diferentes significa dois worktrees e
dois diretórios na mesma moldura visual. É permitido e útil (comparar dois agentes no mesmo
problema), mas a interface tem de mostrar o trabalho de cada aba — a barra de status do painel passa
a ser por aba, não por painel.

### 2.3 Persistência do editor
- Abas abertas e arquivo ativo: persistidos (caminho apenas).
- Conteúdo não salvo: gravado em `drafts/<hash-do-caminho>.txt` a cada 2 s de inatividade e no
  fechamento; restaurado como "recuperado" na abertura, com botão descartar.
- Nunca gravar o arquivo do usuário sem ação explícita de salvar.

### 2.4 Regra de montagem de terminal (aprendida com a referência)
Um único xterm por painel, sempre o da aba ativa. Ao trocar de sub-aba, descarta o xterm e anexa o
próximo **reproduzindo o scrollback** que já vive no host (`replay-start` / `replay-end` já existem
no protocolo). Assim, dez PTYs vivos custam dez processos leves, não dez emuladores montados.

Consequência prática no Melinna: `TerminalView` hoje fecha o `MessagePort` e desanexa ao desmontar —
que é exatamente o comportamento certo. O que muda é que a troca de sub-aba vira
`desmontar` + `montar`, não "manter N em `display:none`". Reanexar custa um replay de scrollback;
manter montado custa memória por pane, para sempre.

---

## 3. Camada de arquivos (novo contrato IPC)

O `window.melinna.files` novo, com o mesmo formato `Result<T>`:

| Método | Uso | Limite |
|---|---|---|
| `list(path)` | uma pasta por vez, ordenada (pastas antes, ordem natural) | 5.000 entradas |
| `read(path)` | texto UTF-8, devolve `{ content, hash, size, isBinary }` | 5 MB; binário recusado |
| `write(path, content, expectedHash)` | salvar com verificação otimista de concorrência | 5 MB |
| `stat(path)` | mtime, tamanho, tipo | — |
| `rename(path, newName)` | renomear no mesmo diretório | nome validado |
| `remove(path)` | mover para a lixeira do SO (não apagar de vez) | — |
| `watch(paths)` / `unwatch` | eventos alterados por debounce de 300 ms | 1 watcher por raiz |
| `search(query, opts)` | busca por conteúdo | ver §3.2 |

### 3.1 Segurança (não negociável)
- Toda operação exige que o caminho resolvido (`realpath`) esteja **dentro** de uma raiz
  registrada: `Group.repoPath` de um workspace aberto ou o `worktreePath` de uma execução.
  Symlink/junction que escapa da raiz é recusado com erro, não seguido.
- `write` só em arquivo regular; nunca em `.git/` interno, nunca criando executáveis.
- Sem `shell: true` em lugar nenhum; nada de `exec`.
- `remove` usa lixeira (Electron `shell.trashItem`), com confirmação na interface.
- O renderer nunca recebe caminho fora das raízes acima; erros não vazam conteúdo.

### 3.2 Busca
- **Busca por conteúdo**: primeiro tenta `rg` (ripgrep) no PATH — saída JSON, respeitando
  `.gitignore`; se não existir, fallback próprio percorrendo a árvore com os mesmos filtros, com
  teto de 2.000 resultados e 20 MB varridos. O teto é reportado na interface, não engolido.
- **Ir para arquivo (Ctrl+P)**: índice de caminhos por workspace, mantido em memória, atualizado
  por eventos de arquivo; busca difusa própria (algoritmo pequeno, testado).

### 3.3 Onde mora
- `src/core/files/` — regras puras: normalização, validação de caminho dentro da raiz, filtro de
  ignorados, ordenação natural, cálculo de diff de índice. Sem `fs`.
- `src/adapters/` — implementação com `node:fs` por trás da porta `FileSystemPort`.
- `src/main/ipc/register-files.ts` — comandos, validação de entrada (padrão dos `validate-*.ts`).
- Renderer só fala com `window.melinna.files`.

---

## 4. Editor de código

### 4.1 Escolha de componente (pendente de aprovação — Princípio VII)

| | CodeMirror 6 | Monaco |
|---|---|---|
| Peso | ~250 KB base + linguagens sob demanda | 3–5 MB, workers separados |
| Muitas instâncias (grade com 4 painéis) | leve, feito para isso | pesado, ~80 MB de heap cada |
| Paridade VS Code (minimapa, IntelliSense nativo) | não | sim |
| LSP | via `@codemirror/lsp-client` (existe, menos maduro) | via `monaco-languageclient` (maduro) |
| Tema por token CSS | direto | precisa de tema JSON próprio |
| Licença | MIT | MIT |

**Recomendação: CodeMirror 6 na v1** (MIT, múltiplas instâncias baratas, tema casado com os tokens
Melinna). Monaco entra depois, se IntelliSense por LSP virar requisito — e aí num painel único, não
na grade inteira.

Dependências novas a registrar no plan (todas MIT): `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`, `@codemirror/search`, `@codemirror/language`, `@codemirror/autocomplete`,
`@codemirror/lang-javascript`, `@codemirror/lang-json`, `@codemirror/lang-markdown`,
`@codemirror/lang-python`, `@codemirror/lang-rust`, `@codemirror/lang-css`, `@codemirror/lang-html`.

### 4.2 Comportamento mínimo da v1
- Abrir por duplo clique na árvore ou Ctrl+P; abas com bolinha de "sujo".
- `Ctrl+S` salva; `Ctrl+W` fecha aba pedindo confirmação se suja; `Ctrl+Tab` alterna abas.
- Realce de sintaxe por extensão; sem autocomplete na v1 (fica para LSP).
- Recarregar quando o arquivo muda em disco **e** a aba está limpa; se suja, avisar conflito.
- Modo somente leitura para arquivos grandes (> 2 MB) e binários.
- Nada de salvar automaticamente: o Princípio II (nunca escrever sem intenção) vale também aqui —
  a única exceção é o usuário editar um arquivo de **worktree** e mandar salvar explicitamente.

### 4.3 Diferencial sobre a referência
A referência só pré-visualiza. Aqui: editar, salvar, buscar, ir para arquivo, e **o editor divide
espaço com os terminais na mesma grade**. É isso que o IntelliJ/VS Code fazem e o Alethe não.

---

## 5. Terminais simultâneos

Já funciona por painel. Falta:
1. **Sub-abas dentro de um painel** (§2.2): faixa de 34px no topo do painel, cada aba com ícone do
   agente, nome, status (rodando/parado/falhou), marca de "não lido" e menu (renomear, duplicar,
   fechar, matar). A referência usa uma faixa **vertical de 36px à esquerda** do painel; aqui a
   faixa horizontal é melhor porque o cabeçalho do painel já existe e porque a largura é o recurso
   escasso quando há quatro terminais lado a lado.
2. **Aba de projeto no topo** (opcional nesta fatia): trocar entre workspaces abertos sem perder a
   grade de cada um. Cada workspace guarda seu próprio `LayoutState`.
3. **Foco**: `Ctrl+1..9` vai para a N-ésima sub-aba; `Shift+Tab` circula terminais como já circula
   painéis.
4. **Indicador de "está trabalhando"**: derivado do `busy-tracker` que já existe, com ponto pulsante
   na aba — sem inventar heurística nova.

**Não haverá comando "dividir à direita/abaixo".** A referência não tem, e por um bom motivo: com
os quatro modos de layout e a grade personalizada, dividir "na mão" é um caminho paralelo que
dessincroniza o estado. Adicionar um painel e escolher o arranjo (ou arrastar para uma célula livre)
cobre o mesmo uso com um modelo só.

Dois limites que a referência usa e valem copiar como números, não como código:
- no máximo **3 PTYs nascendo ao mesmo tempo** e **2 painéis montando ao mesmo tempo** (senão a
  abertura de um workspace com oito agentes trava a interface);
- **debounce de 80 ms** no ajuste de tamanho, e nenhum `resize` ao PTY enquanto uma divisória está
  sendo arrastada.

Custo de memória é o risco real: cada PTY vivo + cada xterm montado. A referência resolve com
"desativar terminal" e "suspender grupo". Aqui: oferecemos **"Congelar painel"**, que desanexa o
xterm e mantém só o PTY no host — reanexa ao clicar, com replay do scrollback. Isso já é suportado
pelo protocolo existente.

---

## 6. Orquestração (fatia posterior, mas decidir o rumo agora)

### 6.1 O que clonar como conceito
Um agente **planejador** que delega trabalho a **workers**, onde worker é processo real com worktree
isolado, e o resultado volta para o planejador. Um **quadro** por workspace mostra os jobs.

### 6.2 Como encaixa no Melinna (vantagem: metade está pronta)
- Worker = execução existente (worktree, branch, diff, remoção com checagem de perda). Não precisa
  de nada novo no núcleo.
- Delegação = **servidor MCP** pequeno, iniciado pelo principal, exposto ao planejador via
  configuração de MCP por agente (`--mcp-config` do Claude, equivalente no Codex). Ferramentas:
  - `delegate(prompt, agentId, baseRef?) -> { execId }`
  - `status(execId) -> { state, exitCode, lastLines }`
  - `wait(execIds[], timeoutSeconds) -> { changed: [...] }`
  - `diff(execId) -> { files, stat }`
  - `apply(execId) -> { merged | conflict }`
  - `cancel(execId)`
- O servidor MCP fala com o **mesmo `ExecutionService`** que o IPC usa. Sem caminho paralelo.
- Duas ideias da referência que valem copiar por serem baratas e resolverem problemas reais:
  - **`initialize` com estado vivo**: a resposta inicial do servidor descreve quais agentes estão
    instalados, quantos workers cabem agora e qual política de permissão vale. O planejador deixa de
    tentar delegar para um agente que não existe naquela máquina.
  - **Entrega com confirmação**: todo resultado devolvido ao planejador carrega um número de sequência
    e um cursor de confirmação. Se a resposta se perder, o mesmo resultado é reentregue marcado como
    repetição. Nunca se perde trabalho por causa de uma chamada que falhou.
- Transporte: **stdio** (padrão de MCP, canal bidirecional). Ver §6.5.

### 6.3 O que **não** copiar da referência
- Dois sistemas de orquestração concorrentes no mesmo código (um deles desconectado).
- Modo stream-json como *única* via de conversa: no Melinna o PTY é a fonte da verdade
  (Princípio III). O planejador pode rodar em PTY normal; só o worker delegado usa protocolo JSON
  quando necessário — e isso entra como **capacidade declarada no catálogo**, não como caso especial.
- Bypass de permissão como padrão. A política de permissão por execução já existe; a delegação
  herda a política do planejador e **pede aprovação** antes de o worker rodar com permissões
  ampliadas.

### 6.4 Pré-requisito
O "quadro" é um tipo de painel (`kind: 'board'`), então depende da §2. Depois disso, a ordem é:
servidor MCP → painel do quadro → aplicação de worktree com resolução de conflito.

### 6.5 Lição cara de transporte (evitar o mesmo erro)
Na referência o servidor MCP é **HTTP POST, uma mensagem entra e uma resposta sai**, sem canal do
servidor para o cliente. Consequência: o planejador não pode ser notificado de que um worker
terminou — ele é obrigado a **ficar consultando** (`check`) em ciclo. O próprio autor registra isso
como decisão fechada ("do not re-open without changing the transport").

Aqui: **stdio**, que é o transporte padrão de MCP e dá canal bidirecional. E, para não repetir o
laço de consulta, a ferramenta `wait(execIds, timeoutSeconds)` que só responde quando algum worker
muda de estado — o planejador espera, não gira.

Outro detalhe que vale registrar: a referência só confia em sinal de cota de dois agentes (Claude e
Codex) e mantém uma tabela de preço por token fixa no Rust, que ela mesma admite estar desatualizada.
No Melinna, cotas ficam **fora** da v1 da orquestração: delegar é o problema; escolher o agente mais
barato é um problema de otimização que só faz sentido depois de haver histórico real.

---

## 7. Identidade visual (Melinna, não Alethe)

Referência serve para **informação e interação**, nunca para paleta. Tokens novos a acrescentar em
`src/renderer/theme/tokens.css`, todos derivados dos que já existem:

| Token novo | Papel | Valor inicial |
|---|---|---|
| `--rail` | fundo do rail de atividades | `#0b0d12` (surface) |
| `--rail-active` | item ativo do rail | `var(--surface-raised)` + barra de 2px `var(--accent)` |
| `--tree-row-hover` | hover na árvore | `rgba(255,255,255,0.04)` |
| `--tree-indent` | recuo por nível | `14px` |
| `--git-added` / `--git-modified` / `--git-deleted` / `--git-ignored` | decoração de git na árvore | `--band-3` / `--band-2` / `--danger` / `--muted` |
| `--tab-active-bg` / `--tab-active-fg` | aba ativa | `var(--surface)` / `var(--core)` |
| `--tab-dirty` | marca de não salvo | `var(--accent)` |
| `--editor-bg` / `--editor-gutter` | superfície do editor | `var(--field)` / `var(--vignette-3)` |
| `--syntax-keyword` … `--syntax-string` | realce | derivar das seis faixas, nunca inventar cor solta |

Regras herdadas da constituição X: tema escuro primário, seis faixas na mesma ordem, nada de gradiente
decorativo, nada de cor fixa no componente.

---

## 8. Fatias de entrega

Cada fatia é uma feature Spec Kit própria (spec → plan → tasks), com testes antes da implementação.

| # | Fatia | Entrega | Estimativa |
|---|---|---|---|
| F1 | **Contrato de arquivos** | porta `FileSystemPort`, adaptador `node:fs`, IPC `files.*`, validação de raiz, testes de segurança (escape por symlink, caminho fora da raiz, binário, arquivo grande) | 4–6 d |
| F2 | **Explorador** | rail de atividades, árvore com lazy load, decoração de git, menu de contexto, renomear/apagar/revelar, arrastar para painel | 5–7 d |
| F3 | **Editor** | CodeMirror 6, abas, sujo, salvar com hash, recuperação de rascunho, conflito de arquivo alterado | 8–10 d |
| F4 | **Painel unificado** | `Pane` + migração v2, painel de editor na grade, painel de preview, sub-abas de execução, congelar painel | 8–10 d |
| F5 | **Busca** | ir para arquivo (Ctrl+P) com índice, busca por conteúdo com `rg` e fallback | 5–7 d |
| F6 | **Abertura de workspace** | assistente de primeira abertura (agente detectado, pasta, tema), já pendente no handoff | 3–4 d |
| F7 | **Orquestração** | servidor MCP de delegação, painel de quadro, aplicação de worktree | 12–18 d |

Total até F5: **30–40 dias** de um dev sênior. F7 é um projeto à parte.

---

## 9. Decisões que dependem de você

1. **Licença**: reimplementação limpa (recomendada) ou fork AGPL? Tudo neste plano assume a
   primeira.
2. **Constituição**: emendar o Princípio IX para v1.2.0 registrando que a leitura da referência para
   análise de comportamento é autorizada, mantendo proibida a cópia de código, a paráfrase de
   implementação e o uso de assets/marca. Sem isso, o `software-clone/` fica em zoneamento cinza.
3. **Editor**: CodeMirror 6 (recomendado) ou Monaco desde já?
4. **Escopo do `software-clone/`**: apagar após a análise ou manter fora do git (`.gitignore`)?
5. **Ordem**: F1→F2→F3 (explorador e editor primeiro) ou F4 antes (visualização multi-painel com
   sub-abas), que é mais rápida de mostrar?
