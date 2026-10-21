# Validação do projeto de referência — Alethe

Data: 2026-10-21. Escopo: validar o repositório em `software-clone/alethe-agents` como fonte de
inspiração para (a) múltiplos terminais e (b) orquestração de agentes, e definir o que é clonável,
o que é descartável e o que é proibido.

Este documento descreve **comportamento**, não código. Nenhuma linha do original é copiada,
transcrita ou parafraseada aqui — é o que o Princípio IX exige e o que a licença permite com
segurança.

---

## 1. Veredito

O Alethe é uma referência **boa e madura** para a parte de terminais/workspace: modelo de domínio
claro, motor de layout próprio, PTY real com scrollback em disco e reanexação. Vale clonar
comportamento em quase tudo dessa camada.

Para **orquestração de agentes** ele é uma referência **parcial e em obra**: existe um sistema real
(planner que delega para workers como processos de verdade, com isolamento em worktree), mas o
próprio autor documenta que há duas iniciativas de orquestração concorrentes no código, uma delas
"currently disconnected", e que metade dos caminhos nunca foi testada ponta a ponta.

E ele **não resolve o seu diferencial**: tem árvore de arquivos com decoração de git, mas arquivo
aberto vira *preview* somente leitura (texto, imagem, vídeo, PDF, markdown) — **não há editor de
código**. Não há abas de arquivo com estado sujo, não há salvar, não há busca em arquivos.

Conclusão prática: **clonar a camada de workspace/terminal, ignorar a camada de orquestração como
design e reimplementar só o conceito, e construir o editor + explorador como diferencial próprio.**

---

## 2. Ficha técnica

| Item | Valor |
|---|---|
| Nome / versão | Alethe 1.7.0, autor Kauã Miguel |
| Licença | AGPL-3.0-or-later (código) + marca separada em `TRADEMARK.md` |
| Shell desktop | Tauri 2 (Rust), não Electron |
| Frontend | React 18, TypeScript, Vite, Zustand, xterm.js 5.5 |
| Terminal | `portable-pty` (Rust) + xterm.js, com ponte opcional para o renderizador `ghostty` |
| Layout | `react-resizable-panels` + CSS grid próprio |
| Arrastar e soltar | `@dnd-kit/core` |
| Persistência | JSON local (`projects.json`) + scrollback binário em disco |
| Tamanho | ~108,6 mil linhas TS/TSX (563 arquivos, 200 componentes), ~54,6 mil linhas Rust (104 arquivos), ~30 mil linhas CSS, 69 crates |
| Superfície de backend | 338 comandos registrados no Tauri |
| Testes | 150 arquivos Vitest (~1.087 casos), ~694 testes Rust, 9 especificações WebDriver (3 na suíte padrão) |
| i18n | 3 idiomas (en/pt-BR/zh-CN), ~3.149 chaves, tipado — falta de tradução quebra o build |
| Temas | 16 embutidos + sistema de tema por plugin |
| Plataforma | Windows-first; Linux/macOS com build mas pouca validação real |

Comparação de escala com o Melinna hoje: **~10,8 mil linhas TS/TSX**. Somando TypeScript, Rust e CSS,
a referência tem **~193 mil linhas — cerca de 18×**. Isso importa: a decisão não é "portar o app", é
"escolher quais 10–15% dele interessam".

---

## 3. Licença: o que pode e o que não pode

O usuário autorizou clonar porque o projeto é open source. Isso está correto, mas com limites
precisos que afetam o produto comercial:

**Pode**
- Ler o código, rodar o app, estudar comportamento.
- Reimplementar as *ideias*, os fluxos e a organização visual com código próprio.
- Copiar código — **desde que o Melinna passe a ser distribuído sob AGPL-3.0** e o código-fonte
  seja oferecido a quem recebe o instalador.

**Não pode**
- Usar o nome "Alethe", o logo, os ícones, o avatar e os assets de marca — o `NOTICE` é explícito:
  a marca não está sob a AGPL e governa-se por `TRADEMARK.md`.
- Copiar trechos de CSS/tokens que constituem a identidade visual deles (paleta, ícones, fontes de
  símbolos proprietárias como `AletheTerminalSymbols`).

**A decisão que você precisa tomar agora**
1. **Reimplementação limpa** (recomendada): comportamento clonado, código escrito do zero. O Melinna
   continua fechado e com licença própria. Custo: mais tempo.
2. **Fork do Alethe**: parte de 180 mil linhas prontas, mas o Melinna vira AGPL (código aberto
   obrigatório para qualquer cliente) e o app é Tauri/Rust, não Electron — ou seja, você jogaria
   fora o núcleo, o host de PTY e o layout que já tem.
3. **Licença comercial** com o autor: existe contato no repositório; resolveria o problema jurídico
   sem reescrever.

Nada aqui impede usar o app como **referência visual e de comportamento** — que é o que a seção 6
propõe.

---

## 4. Inventário de funcionalidades (com esforço de porte para Electron/TS)

Legenda de esforço: S ≤ 2 dias, M ≤ 5, L ≤ 12, XL > 12 (um dev sênior, já familiarizado com o
projeto).

**Orçamento total:** o núcleo que realmente importa (workspace, PTY, sub-abas, ciclo de vida de
agente, MCP, git/worktree, painéis, temas) custa **~95–110 dias**. Clonar *tudo* custa 250+ dias e a
maior parte do excedente é passivo de manutenção.

### Workspace e projetos
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Vários projetos abertos ao mesmo tempo, cada um como "container" na área central | CORE | L |
| Abas de projeto no topo, com reordenação por arrastar | CORE | M |
| Fechar container sem matar o PTY | CORE (Melinna já faz) | S |
| Colapsar container em cabeçalho compacto | NICE | M |
| Container em tela cheia | CORE | S |
| Modo "flat": misturar painéis de projetos diferentes numa grade só | NICE | M |
| Restaurar containers e abas recentes ao reabrir | CORE | M |
| Grupos e subgrupos com cor, ícone, recolhimento e suspensão | CORE | M |

### Layout
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Auto (1 cheio, 2 lado a lado, 3+ em grade) | CORE — **Melinna já tem** | — |
| Spotlight (um principal + secundários empilhados) | NICE — já tem | — |
| Sidebar (lista estreita + painel grande) | NICE — já tem | — |
| Grade personalizada com `colSpan`/`rowSpan` e frações arrastáveis | CORE — já tem | — |
| Layout por projeto, por grupo e por workspace (herança em 3 níveis) | CORE | M |
| Arrastar painel sobre painel para trocar de lugar | CORE — já tem | — |

### Terminais e PTY
| Funcionalidade | Valor | Esforço |
|---|---|---|
| PTY real por painel, com spawn/attach/write/resize/restart/kill | CORE — já tem | — |
| Scrollback persistido por PTY e reanexado com emenda por deslocamento de bytes | CORE — já tem | — |
| Busca dentro do terminal | CORE — já tem | — |
| Copiar/colar nativo | CORE | S |
| Histórico de prompts por terminal | NICE | S |
| Overlay de reinício quando o processo sai | NICE | S |
| Sub-abas dentro de um painel (cada uma com agente, cwd e PTY próprios) | **CORE para o seu caso** | L |

### Agentes e lançadores
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Resolução do executável do agente antes de lançar (PATH, npm, pnpm, Volta, fnm, nvm, Bun, Cargo, Scoop, Chocolatey) | CORE — Melinna resolve por catálogo | M |
| Substituição manual do lançador quando o CLI não é encontrado | CORE | S |
| Flags por agente (ex.: modo sem permissão) | CORE — já tem | — |
| Detecção de agente instalado | CORE — já tem | — |
| Vários perfis locais isolados (contas) | NICE | L |
| Retomada de sessão por agente (`--resume`/session id) | CORE | L |

### Arquivos e painéis de conteúdo
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Árvore de arquivos com decoração de git (adicionado/modificado/ignorado) | CORE | M |
| Menu de contexto: renomear, apagar, revelar no Explorer, abrir | CORE | M |
| Arrastar arquivo da árvore para um painel/grade | NICE | S |
| Preview de imagem, vídeo, PDF, markdown | NICE | M |
| Painel de diff (arquivo alterado) | CORE — já tem | — |
| **Editor de código com abas, estado sujo e salvar** | **AUSENTE no Alethe — seu diferencial** | XL |
| Busca em arquivos / ir para arquivo (Ctrl+P) | CORE para o diferencial | L |

### Memória, histórico e continuidade
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Desativar um terminal para liberar RAM; suspender grupo; reativar | NICE | M |
| Indicador de RAM no chrome da janela | NICE | S |
| Tela inicial com saudação, recentes e ações rápidas | NICE — **já tem** | — |
| Telegramas de uso/cota por provedor | EXOTIC | L |
| Backup exportar/importar `.zip` com estado e scrollback | NICE | M |

### Sistema
| Funcionalidade | Valor | Esforço |
|---|---|---|
| Barra de título própria com controles de janela | NICE | M |
| Abrir cwd no Explorer / no VS Code | CORE | S |
| Atalhos globais (novo terminal, fechar painel, buscar, ciclo de foco) | CORE | M |
| Modal "ir para terminal" com filtro por projeto/nome/cwd | CORE | M |
| Sistema de plugins com manifesto e capacidades | EXOTIC para agora | XL |
| Temas em pacote (plugin de tema) | NICE | L |
| i18n com três idiomas e checagem de tipo no build | NICE | M |

### Claramente fora de escopo (não portar)
Spotify (OAuth, now playing), Discord presence, comandos de voz/ditado, telemetria própria,
sincronização de GitHub, servidor de controle remoto por LAN, "Agent Canvas" experimental com
mídia rica, MCP registry completo, ponte para `ghostty`.

---

## 5. Arquitetura — o que vale entender antes de copiar

### 5.1 Modelo de domínio
Quatro níveis, do maior para o menor: **Grupo** (coleção lógica) → **Projeto** (unidade de trabalho
com terminais, layout, cor e estado) → **Terminal** (unidade persistente com cwd, PTY, scrollback e
sub-abas) → **Sub-aba** (um agente ou shell dentro do terminal). A representação visual de um
projeto aberto é um **container**; dentro dele, cada **pane** é um terminal renderizado.

O Melinna tem hoje Grupo → Task → Execution, com worktree por Execution. A diferença conceitual
importante: no Alethe o **projeto** é a unidade persistente que o usuário abre e fecha; no Melinna
a unidade persistente é a **execução** (agente + worktree). Isso é uma vantagem do Melinna para o
seu caso — worktree por execução é mais forte que PTY por projeto — mas custa uma camada de
"container" que ainda não existe.

### 5.2 Layout
Três níveis de layout com herança (workspace → grupo → projeto), quatro modos, e a grade
personalizada guarda **frações de trilha** (colunas e linhas como números que somam 1) mais células
com `colSpan`/`rowSpan`. Estado é pequeno, serializável e independente do tamanho em pixels — o que
permite reabrir em outra resolução.

O Melinna já tem exatamente esse desenho em `src/core/layout/` (auto, spotlight, sidebar, custom com
`moveDivider` e `MIN_TRACK_FRACTION`). **O que falta é o nível de aninhamento por projeto**: hoje há
um layout global único.

### 5.3 PTY
Backend Rust com `portable-pty`; saída vai para a interface por eventos (`pty://data/{id}`,
`pty://exit/{id}`); scrollback é gravado em disco e reproduzido na reanexação.

O Melinna é **mais forte aqui**: hospedeiro de PTY em processo separado que sobrevive ao
fechamento da janela, autenticação por segredo local, fluxo com `ack` a cada 256 KB e pausa do PTY
acima de 1 MB sem confirmação, e respostas a consultas de terminal sem painel anexado. Não há nada
a clonar nesta camada.

### 5.3.1 Como a referência representa painéis (validação do nosso desenho)

Detalhe importante: lá **todo painel é um "terminal"** com um campo de tipo — terminal, markdown,
arquivo, imagem, vídeo, web, diff, orquestrador, plugin. Ou seja, a união discriminada que este
plano propõe (`Pane.kind`) já foi validada por eles na prática; a diferença é que no Melinna o painel
de terminal carrega **execuções** (com worktree e estado de agente), não apenas um PTY.

Outros fatos úteis:
- **Não existe comando "dividir à direita/abaixo".** O usuário adiciona um painel e a divisão vem do
  modo de layout (auto/spotlight/sidebar/grade), ou arrastando para uma célula vazia da grade.
- **Um único xterm por painel visível.** Ao trocar de sub-aba o xterm é destruído e o novo anexa
  reexecutando o scrollback vindo do backend (até 512 KB). Trocar de aba custa disco, não memória.
  Isso contradiz a intuição de "mantenha todos montados" — e é o que permite dezenas de PTYs vivos.
- **Abas de workspace não são desmontadas**: ficam com `visibility:hidden` para o xterm nunca medir
  zero. Limites: 10 superfícies montadas, 2 transmitindo em segundo plano; o resto é "parked".
- **Filas de concorrência**: no máximo 3 spawns de PTY e 2 montagens simultâneas.
- **Layout em quatro escopos**: projeto, grade nomeada do projeto, grupo e workspace — cada um com
  seu próprio estado, o mais específico vencendo.
- **Ajuste de tamanho**: `ResizeObserver` + debounce de 80 ms, ignora enquanto uma divisória está
  sendo arrastada, e só manda `resize` ao PTY se colunas/linhas mudaram de fato.

### 5.4 Orquestração
Conceito: o agente **planejador** (Claude Code ou Codex) recebe uma ferramenta MCP de delegação e, ao
chamá-la, o app **lança um worker como processo real** — não é subagente interno do fornecedor. Cada
worker pode rodar isolado num **git worktree** próprio; o resultado volta para o planejador; um
canvas por projeto mostra a floresta de jobs com status, custo e diff inline.

Como está montado, em fatos:

- **Servidor MCP dentro do processo do app**, HTTP JSON-RPC em `127.0.0.1` (faixa de portas),
  autenticado por token aleatório e escopado por terminal planejador. Para cada terminal é gerado um
  arquivo de configuração que o agente recebe por `--mcp-config` (Claude). O Codex só fala MCP por
  stdio, então eles geram **um bridge PowerShell stdio→HTTP** — gambiarra que existe por causa da
  escolha de transporte.
- **11 ferramentas**: `delegate`, `check`, `status`, `steer`, `send`, `answer`, `cancel`, `release`,
  `diff`, `rules`, `guide` (mais `open_shell`/`shell_output` quando há host de shell).
- O `initialize` devolve instruções **derivadas do estado vivo** — CLIs de worker configurados, limite
  de concorrência, conjuntos de regras existentes — para o planejador nunca pedir um worker que não
  pode nascer. Boa ideia, barata de copiar.
- **Workers não são PTYs**: são streams JSON headless (`codex app-server --stdio`; `claude -p
  --input-format stream-json --output-format stream-json`). Progresso vem de **parsear o stdout**
  (eventos de turno, plano, uso de tokens); aprovação chega como requisição JSON-RPC e o job fica
  `blocked` até `answer`.
- **Entrega com confirmação**: cada resultado ao planejador tem `seq` e cursor de ack; o não
  confirmado é reentregue marcado como repetido. Resolve resposta HTTP perdida sem perder trabalho.
- **Concorrência**: 4 workers por padrão (1–16), fila FIFO, até 4 workers terminados ficam "estacionados"
  para perguntas de acompanhamento, watchdog por job (900 s padrão) que mata e entrega o que houver.
- Canal **separado** de hooks para os subagentes nativos do próprio planejador — outra subsistema.

Limites documentados pelo autor, que valem como aviso:
- Não existe canal de aprovação interativo no stream-json do Claude via CLI puro: chamada que precisa
  de permissão é **auto-negada** e reportada; a saída deles foi rodar com bypass de permissões.
- Não existe "steer" no meio do turno no Claude (só interromper e reenfileirar); no Codex existe.
- Há uma segunda iniciativa de orquestração (fila por DAG alimentada por arquivos de planejamento)
  que está no código mas **desconectada** — reconciliação pendente há versões.
- `scheduler.rs`/`supervisor.rs` são protótipo: o "reinício de agente" é só publicação de evento.

Para o Melinna, a leitura é: **o conceito é bom, a implementação é um rascunho caro**. E o Melinna já
tem a metade difícil (worktree por execução, diff, remoção com checagem de perda, troca de
modelo/permissão em voo).

### 5.4.1 Lições práticas de plataforma (as que doem e ninguém documenta)

- **PATH reconstruído**: eles não confiam no PATH do processo da interface — releem o PATH do
  registro/ambiente da máquina e varrem diretórios de npm, pnpm, Volta, fnm, nvm-windows, Bun, Scoop,
  Chocolatey e Cargo, testando `.cmd`, `.exe`, `.bat`, `.ps1` nessa ordem. Instalação e desinstalação
  são notadas na hora porque só os acertos são cacheados e cada acerto é revalidado.
- **Lançamento embrulhado em shell**: no Windows, `powershell -NoLogo -NoProfile -Command "& '<alvo>'
  <args>; exit $LASTEXITCODE"`. Isso contraria a postura do Melinna (Princípio VIII: nunca por shell).
  Para nós a decisão é a oposta: resolver o alvo real e lançar por vetor de argumentos — o que já é
  feito — e aceitar que CLIs empacotados como `.cmd` exigem resolução para `node` + script.
- **Higiene de ambiente**: remover `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDECODE_PARENT_PID` do
  ambiente do filho, senão um terminal Claude se acha aninhado dentro de outro. Barato e crítico.
- **Um xterm por painel visível**, reanexando por replay (até 512 KiB) em vez de manter N emuladores.
- **Escrita de scrollback por uma única thread** (append a cada 250 ms, compactação acima de 8 MiB) —
  evita contenção de I/O com muitos PTYs.
- **Coalescência de saída** em lotes de até 64 KiB ou 16 ms, e canal separado (a cada 450 ms) para
  painéis ocultos.
- **Gate de RAM antes de abrir PTY**: não inicia abaixo de 400 MB disponíveis, com aviso na interface.

### 5.5 Persistência
JSON único por perfil com escrita atômica (tmp → rename) e debounce, esquema versionado com
migração, scrollback em arquivos binários separados, log de spawn à parte. Simples e suficiente; o
Melinna já usa escrita atômica (`atomic-file.ts`) e esquema versionado (`STATE_SCHEMA_VERSION`).

---

## 6. Como usar a referência sem violar a licença nem a constituição

Regra operacional para o resto do projeto:

1. **Nada de copiar código.** Toda funcionalidade entra na spec como descrição de comportamento e
   é implementada do zero. Foi o que este documento fez.
2. **Nada de copiar marca.** Nenhum asset, nome de componente, string, ícone ou token de cor do
   Alethe.
3. **Layout e fluxo são livres.** "Árvore à esquerda, abas no topo, grade de painéis no centro,
   inspetor à direita" é padrão de mercado (VS Code, IntelliJ, tmux) e não é protegido.
4. **A constituição precisa de emenda.** O Princípio IX hoje diz que o repositório de referência
   *não pode nem ser lido*, com uma exceção pontual registrada em v1.1.0. Você autorizou a leitura
   agora; para que isso não fique em conflito com a governança do projeto, a emenda v1.2.0 deve
   registrar: pode ler para analisar comportamento; continua proibido copiar código, parafrasear
   implementação, usar assets ou marca; toda conclusão entra na spec como comportamento.
   Sem essa emenda, qualquer sessão futura (ou outro agente) vai tratar o `software-clone/` como
   proibido — e há inclusive o risco de ele ser commitado por engano.

---

## 7. O que o Melinna já tem (e não precisa clonar)

| Camada | Situação |
|---|---|
| PTY real, processo hospedeiro separado, reanexação | Pronto e mais robusto que a referência |
| Scrollback em disco com fluxo e controle de pressão | Pronto |
| Worktree por execução, branch, remoção com checagem de perda | Pronto |
| Catálogo declarativo de agentes + detecção | Pronto |
| Troca de modelo/permissão em voo | Pronto |
| Diff por execução | Pronto |
| Layout: auto, spotlight, sidebar, grade personalizada, arrastar | Pronto |
| Árvore de workspaces/tarefas/execuções | Pronto (sem arquivos) |
| Tela inicial | Pronto |
| Instalador Windows | Pronto |

## 8. Lacunas reais (o que falta para o produto que você descreveu)

1. **Explorador de arquivos + editor de código com abas** — o diferencial. Ausente no Melinna e
   ausente na referência (lá é só preview).
2. **Terminais múltiplos por projeto, com abas de projeto e sub-abas por painel** — o Melinna tem
   grade global, não tem o aninhamento por projeto nem sub-abas.
3. **Orquestração**: um agente que delega trabalho a outros, com isolamento e resultado.
4. **Busca em arquivos e "ir para arquivo"** — sem isso o explorador é um passa-tempo.
5. **Assistente de primeira abertura** (já pendente no handoff).

## 9. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Licença AGPL mal entendida | Produto fechado contaminado | Reimplementação limpa; registrar em `docs/` e na constituição |
| `software-clone/` ser commitado | Vazamento de 180 mil linhas de terceiros no seu repo | `.gitignore` + decisão de apagar após a análise |
| Escopo de 18× | Nunca entregar | Fatiar: explorador+editor primeiro, orquestração depois |
| Editor pesado (Monaco) | Bundle grande, memória por pane | Decidir entre CodeMirror 6 e Monaco na spec da feature |
| Orquestração por stream-json | Bypass de permissão vira padrão | Definir política de permissão antes de implementar |

## 10. Próximo passo

Ver `docs/plano-explorador-e-multiterminal.md`, que detalha a arquitetura do diferencial
(explorador + editor + terminais simultâneos) e a fatia de orquestração.
