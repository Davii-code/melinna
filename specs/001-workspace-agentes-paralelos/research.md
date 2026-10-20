# Research: Workspace de agentes paralelos

Decisões técnicas e alternativas. Nenhum código do projeto de referência foi lido; tudo aqui é decisão própria.

## R1. Electron + node-pty em vez de Tauri + portable-pty

- **Decisão**: Electron com node-pty (decisões D1 e D2 do dono).
- **Motivo**: TypeScript de ponta a ponta, núcleo reaproveitável num daemon/CLI Node, node-pty maduro com ConPTY, xterm.js nativo no renderer.
- **Custo**: binário de 100–150 MB; recompilação do node-pty para o ABI do Electron (`@electron/rebuild`), que exige Build Tools no Windows.
- **Alternativa rejeitada**: Tauri 2 + `portable-pty` — binário menor, mas ponte de streaming Rust↔webview própria e diferenças de renderização entre WebView2 e WebKitGTK.

## R2. Processo hospedeiro destacado

- **Decisão**: um processo Node (`ELECTRON_RUN_AS_NODE=1` com o binário do Electron) dono dos PTYs, destacado do principal, com conexão autenticada por segredo local.
- **Motivo**: a História 2 exige que agentes sobrevivam ao fechamento do app. No ConPTY, o processo que cria o pseudoconsole é o dono; se ele morre, o console fecha. Portanto o dono não pode ser o processo principal.
- **Alternativas rejeitadas**: (a) PTYs no principal com app "minimizado na bandeja" — fechar de fato mataria tudo; (b) `tmux`/`screen` — não existem no Windows; (c) serviço do sistema — exige instalação privilegiada.
- **Consequência**: o hospedeiro grava o scrollback (é o único que vê todos os bytes com a janela fechada) e mantém `host/registry.json`. Também precisa responder às consultas do terminal (DA, DSR, CPR, OSC de cor) quando nenhum painel está anexado, porque sem resposta alguns agentes travam; a resposta de posição de cursor é aproximada. Alternativa exata, pendente de aprovação por ser dependência nova: `@xterm/headless` no hospedeiro, mantendo o estado da tela de cada execução.

## R2b. Controle de fluxo

- **Decisão**: `pty.pause()`/`resume()` no hospedeiro por marcas alta (1 MB) e baixa (256 KB) de bytes sem `ack` da página.
- **Motivo**: sem isso, um agente que despeja saída enche as filas do principal e da página, estourando memória e latência.

## R3. Transporte principal ↔ hospedeiro

- **Decisão**: pipe nomeado (Windows) / socket Unix (POSIX) com quadros binários: cabeçalho JSON + carga binária opcional, prefixados por comprimento.
- **Motivo**: local, sem porta TCP exposta, suporta binário sem base64.
- **Alternativa rejeitada**: TCP em localhost — qualquer processo local poderia tentar conectar e firewalls corporativos interferem.

## R4. Bytes de saída até o painel

- **Decisão**: `MessageChannelMain` por painel entre principal e renderer, transferindo `Uint8Array`.
- **Motivo**: evita serializar o fluxo pelo canal IPC geral e isola o tráfego de cada painel.

## R5. Scrollback em segmentos

- **Decisão**: segmentos de 2 MB nomeados pelo deslocamento inicial (`<offset 16 dígitos>.seg`), máximo de 4 segmentos (8 MB); o mais antigo é apagado antes de abrir um novo. Arquivo `meta.json` por execução com deslocamento total, lacunas e descartes.
- **Motivo**: rotação por apagar arquivo é O(1) e não reescreve dados; o nome dá busca direta por deslocamento.
- **Alternativa rejeitada**: `addon-serialize` do xterm — prende o histórico à interface, contra o Princípio IV.

## R6. Detecção de ocioso para troca em voo

- **Decisão**: `BusyTracker` no principal a partir de eventos `activity` do hospedeiro (no máximo 1 a cada 250 ms por execução); ocioso = 1,5 s sem saída.
- **Motivo**: heurística universal; os agentes não expõem estado de forma padronizada.
- **Limite conhecido**: agentes que animam indicadores mesmo ociosos podem parecer sempre ocupados; o usuário pode forçar a troca pelo diálogo, que avisa da interrupção.

## R7. Catálogo inicial: capacidades a confirmar na implementação

As flags abaixo são o ponto de partida; cada task de entrada de catálogo confirma contra o `--help` da versão instalada e registra a versão verificada em `catalog/agents.json` (`verifiedWith`).

| Agente | Modelo | Modo de permissão | Enunciado | Troca de modelo em voo | Retomada |
|--------|--------|-------------------|-----------|------------------------|----------|
| Claude Code | `--model <m>` | `--permission-mode default\|acceptEdits\|plan\|bypassPermissions` | argumento posicional | comando `/model <m>` no PTY | `--continue` |
| Codex CLI | `--model <m>` | combinação de `--sandbox` e `--ask-for-approval` por opção | argumento posicional | comando `/model` no PTY (confirmar) | `resume --last` (confirmar) |
| Gemini CLI | `--model <m>` | `--approval-mode default\|auto_edit\|yolo` | `--prompt-interactive <texto>` | confirmar; se ausente, `restart-resume` ou `unsupported` | confirmar |
| Shells | — | — | não aceita | — | — |

Listas de modelos: cada entrada traz sugestões e `allowCustom: true`, porque os nomes de modelo mudam com frequência maior que o app.

## R8. Diff

- **Decisão**: sem `--binary`; usar `git diff <base> --no-color --no-ext-diff --unified=3 -M` no worktree (inclui stage e fora de stage, e commits a partir da base) mais `git ls-files --others --exclude-standard -z` para não rastreados, cada um diffado com `git diff --no-index -- /dev/null <arquivo>` (`NUL` no Windows é tratado pelo git). Binários detectados pelo cabeçalho `Binary files differ` e tamanhos lidos com `git cat-file -s` e `fs.stat`.
- **Motivo**: não altera o índice do worktree (sem `git add -N`), e o parser próprio de diff unificado alimenta os dois modos de exibição.

## R9. Estado da interface

- **Decisão**: stores próprios com `useSyncExternalStore`, alimentados por eventos do principal.
- **Motivo**: poucos estados globais; evita dependência nova.

## R10. Arrastar, soltar e divisórias

- **Decisão**: eventos de ponteiro próprios para divisórias e HTML5 drag and drop para reordenar cabeçalhos.
- **Motivo**: requisitos simples; algoritmos de layout ficam no núcleo como funções puras testáveis.
