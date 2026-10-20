# Feature Specification: Workspace de agentes paralelos (primeira fatia)

**Feature Branch**: `001-workspace-agentes-paralelos` (a pasta ainda não é repositório git)

**Created**: 2026-10-20

**Status**: Draft

**Input**: Aplicativo desktop local-first em que cada execução de um agente de CLI é um terminal PTY real e interativo, isolado em branch e git worktree próprios, com vários agentes lançados em paralelo para a mesma tarefa, conversa contínua por painel, persistência de scrollback, reanexação, grade de painéis com quatro layouts, árvore grupos/tarefas/execuções, seletor de modelo e permissão por painel, catálogo de agentes como dados e comparação de diffs.

## Decisões fixadas antes da spec

| # | Decisão | Valor |
|---|---------|-------|
| D1 | Camada de desktop | Electron, Node no processo principal |
| D2 | PTY | node-pty (ConPTY no Windows), recompilado para o ABI do Electron |
| D3 | Emulador de terminal | @xterm/xterm com addons fit, search, webgl (fallback DOM), unicode11, web-links |
| D4 | Catálogo inicial | Claude Code (`claude`), Codex CLI (`codex`), Gemini CLI (`gemini`); shells PowerShell 7 (`pwsh`), Windows PowerShell (`powershell`), Prompt de Comando (`cmd`), Git Bash (`bash`), e `bash`/`zsh` em macOS/Linux. Depois: Aider, OpenCode, Copilot CLI, Cursor CLI, Qwen Code, Amp |
| D5 | Sistemas operacionais | Windows 10 1809+ validado na primeira fatia; macOS e Linux compilam no CI, validação na fatia seguinte |
| D6 | Nome | Pacote e binário `melinna-desk`; appId `io.github.davii-code.melinna`; nome exibido "Melinna" |
| D7 | Paralelismo | Alvo de 6 execuções vivas simultâneas; teto duro de 12 |
| D8 | Scrollback | 8 MB por execução em disco, segmentos rotativos de 2 MB, descarte do segmento mais antigo; 10.000 linhas em memória por painel |

## Glossário

- **Grupo**: conjunto de tarefas relacionadas, normalmente por repositório ou frente de trabalho.
- **Tarefa**: enunciado do que deve ser feito, com o repositório e o ponto de partida (branch, tag ou commit).
- **Execução**: um agente específico atacando uma tarefa, com sua branch, seu worktree, seu PTY, seu modelo e seu modo de permissão.
- **Painel**: visão de uma execução na grade. Uma execução tem no máximo um painel aberto.
- **Hospedeiro de PTY**: processo separado da interface que é dono dos PTYs e sobrevive ao fechamento da janela.
- **Catálogo**: lista declarativa dos agentes e shells suportados.
- **Faixa**: uma das seis cores da marca usadas para identificar execuções.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Lançar uma tarefa em vários agentes e conversar com cada um (Priority: P1)

O usuário escolhe um repositório e um ponto de partida, escreve a tarefa, marca quais agentes devem tentar e lança. O app cria uma branch e um worktree por agente, abre um painel por execução e lança todos ao mesmo tempo. Cada painel é um terminal interativo: o usuário digita, o agente responde com cores e redesenho de tela, e a conversa continua quantas vezes o usuário quiser, sem relançar nada.

**Why this priority**: é o produto. Sem isso não existe "um feixe entra, seis saem".

**Independent Test**: com um repositório git de teste e um agente de catálogo que é um script controlado, lançar a tarefa em 3 execuções, verificar 3 branches e 3 worktrees, digitar em cada painel e receber resposta, e verificar que a árvore de trabalho principal não mudou.

**Acceptance Scenarios**:

1. **Given** um repositório git válido e três agentes instalados, **When** o usuário lança uma tarefa marcando os três, **Then** o app cria uma branch e um worktree por execução a partir do ponto de partida, cada worktree antes do processo da sua execução, abre três painéis e inicia cada processo assim que o seu worktree fica pronto, dentro do tempo de SC-001.
2. **Given** uma execução viva, **When** o usuário digita texto e Enter no painel, **Then** os bytes chegam ao processo do agente pelo PTY e a resposta aparece no mesmo painel, com cores ANSI e redesenho de tela preservados.
3. **Given** uma execução que já respondeu, **When** o usuário envia uma nova mensagem, **Then** a conversa continua no mesmo processo, sem relançamento.
4. **Given** o catálogo, **When** o usuário abre o diálogo de nova tarefa, **Then** cada agente aparece com o estado "instalado" ou "não encontrado", e os não encontrados não podem ser marcados.
5. **Given** qualquer fluxo desta história, **When** ele termina, **Then** HEAD, branch atual, índice e arquivos da árvore de trabalho principal do repositório estão idênticos ao estado anterior.
6. **Given** o agente aceita o enunciado como argumento inicial, **When** a execução é lançada, **Then** o enunciado é entregue ao agente como argumento do vetor de argumentos, sem passar por shell; **Given** o agente não aceita, **Then** o enunciado é escrito no PTY depois que o processo emite a primeira saída.

---

### User Story 2 - Fechar e reabrir o app sem perder nada (Priority: P1)

O usuário fecha o app com agentes trabalhando. Os agentes continuam rodando. Ao reabrir, os painéis voltam com o histórico no lugar e reanexam aos processos vivos; os processos que morreram mostram o histórico e o código de saída.

**Why this priority**: agentes trabalham por muito tempo; perder a sessão ao fechar a janela torna o produto inutilizável no dia a dia.

**Independent Test**: lançar duas execuções de um script controlado, fechar o app escolhendo "manter rodando", encerrar um dos scripts por fora, reabrir o app e verificar que um painel reanexa e responde, e o outro mostra histórico e código de saída.

**Acceptance Scenarios**:

1. **Given** execuções vivas, **When** o usuário fecha a janela, **Then** o app pergunta "Manter rodando em segundo plano", "Encerrar todos" ou "Cancelar", com "Manter rodando" como padrão.
2. **Given** o usuário escolheu manter rodando, **When** reabre o app, **Then** cada painel mostra o scrollback gravado e, em seguida, a saída nova ao vivo, sem lacuna e sem duplicação de bytes.
3. **Given** um processo terminou enquanto o app estava fechado, **When** o app reabre, **Then** o painel mostra o histórico, o código de saída e o horário do término, e a árvore marca a execução como encerrada.
4. **Given** o usuário escolheu encerrar todos, **When** o app fecha, **Then** todos os processos de agente e seus descendentes são encerrados em até 5 segundos e o scrollback de cada um está gravado.
5. **Given** um painel fechado de uma execução viva, **When** o usuário o reabre pela árvore, **Then** o histórico volta e a execução continua interativa.

---

### User Story 3 - Navegar e gerenciar grupos, tarefas e execuções (Priority: P2)

O usuário vê uma árvore de três níveis com o estado de cada execução e, a partir dela, abre, fecha, para, relança e remove execuções, e cria e renomeia grupos e tarefas.

**Why this priority**: com mais de uma tarefa o usuário se perde sem estrutura; é o mapa do trabalho.

**Independent Test**: criar dois grupos com tarefas e execuções de script controlado, exercer cada ação da árvore e verificar estado, processo e worktree após cada uma.

**Acceptance Scenarios**:

1. **Given** grupos, tarefas e execuções, **When** a árvore é exibida, **Then** cada execução mostra a cor da faixa, o agente, o modelo e um estado entre: preparando, iniciando, rodando, ocioso, encerrado (com código), falhou ao iniciar, perdido.
2. **Given** uma execução rodando, **When** o usuário escolhe "Parar", **Then** o processo e seus descendentes terminam, o estado vira encerrado e o worktree permanece.
3. **Given** uma execução encerrada, **When** o usuário escolhe "Relançar", **Then** um novo processo é lançado no mesmo worktree, com o mesmo agente, modelo e modo de permissão, e o scrollback anterior fica preservado acima de um separador com data e hora.
4. **Given** uma execução encerrada sem trabalho a perder, **When** o usuário escolhe "Remover" e confirma, **Then** o worktree é removido, a branch é apagada ou mantida conforme a escolha do usuário no diálogo, e `git worktree list` não lista mais o caminho.
4a. **Given** uma execução encerrada com arquivos não commitados no worktree ou, se o usuário escolheu apagar a branch, com commits que não estão na base, **When** o usuário escolhe "Remover", **Then** o diálogo mostra quantos arquivos e quantos commits serão perdidos e só remove se o usuário confirmar a remoção forçada; sem essa confirmação nada é removido.
5. **Given** uma execução rodando, **When** o usuário pede "Remover", **Then** o app exige parar antes e não remove nada até lá.
6. **Given** um grupo, **When** o usuário o renomeia ou cria uma tarefa nele, **Then** a mudança persiste após reiniciar o app.

---

### User Story 4 - Comparar o que cada agente mudou (Priority: P2)

Para cada execução, o usuário abre o diff entre o ponto de partida e o estado atual do worktree, em modo lado a lado ou unificado, e decide qual aproveitar.

**Why this priority**: escolher entre os resultados é o fechamento do fluxo; sem diff, o usuário tem de sair do app.

**Independent Test**: num worktree de teste com commit novo, alteração não commitada, arquivo novo não rastreado e arquivo apagado, abrir o diff e verificar que os quatro aparecem nos dois modos.

**Acceptance Scenarios**:

1. **Given** uma execução, **When** o usuário abre o diff, **Then** aparecem commits feitos pelo agente, alterações em stage e fora de stage, arquivos novos não rastreados e arquivos apagados, todos em relação ao commit do ponto de partida.
2. **Given** o diff aberto, **When** o usuário alterna entre lado a lado e unificado, **Then** o mesmo conteúdo aparece no outro modo, sem novo cálculo visível.
3. **Given** um arquivo binário alterado, **When** o diff é exibido, **Then** o arquivo aparece como "binário alterado" com os tamanhos antes e depois, sem conteúdo.
4. **Given** a branch base avançou desde a criação do worktree, **When** o usuário abre o diff ou a árvore, **Then** o app mostra "base avançou N commits" para aquela execução.
5. **Given** um diff maior que 5.000 linhas em um arquivo, **When** exibido, **Then** o arquivo vem recolhido com o número de linhas e só é renderizado quando o usuário pede.

---

### User Story 5 - Organizar os painéis em quatro layouts (Priority: P3)

O usuário escolhe entre Automático, Spotlight, Sidebar e Grade personalizada; redimensiona painéis arrastando divisórias e reordena painéis arrastando e soltando.

**Why this priority**: com seis painéis a organização define se o app é usável, mas o modo Automático já entrega o fluxo das P1.

**Independent Test**: com quatro painéis abertos, alternar os quatro modos, arrastar divisórias e reordenar, reiniciar e verificar que a grade personalizada e a ordem voltaram iguais.

**Acceptance Scenarios**:

1. **Given** N painéis abertos (1 a 12), **When** o modo é Automático, **Then** o app distribui o espaço em linhas e colunas de forma que nenhum painel fique com menos de 40 colunas por 10 linhas de terminal; se não couber, o app passa a mostrar barra de rolagem na grade em vez de encolher abaixo do mínimo.
2. **Given** o modo Spotlight, **When** o usuário clica num painel reduzido ou usa o atalho de próximo/anterior, **Then** esse painel vai para o foco grande e o anterior vai para a faixa reduzida, com a faixa posicionada à direita ou embaixo conforme a proporção da janela.
3. **Given** o modo Sidebar, **When** ativo, **Then** um painel principal ocupa a área central e os demais ficam empilhados numa coluna lateral, com a árvore de navegação visível.
4. **Given** o modo Grade personalizada, **When** o usuário arrasta divisórias, **Then** as proporções mudam ao vivo e ficam salvas após reiniciar.
5. **Given** qualquer modo, **When** o usuário arrasta o cabeçalho de um painel para outra posição, **Then** a ordem muda e fica salva.
6. **Given** qualquer mudança de tamanho de painel, **When** o redimensionamento termina, **Then** o PTY recebe o novo número de colunas e linhas.

---

### User Story 6 - Escolher modelo e modo de permissão por painel (Priority: P3)

Cada painel tem um seletor de modelo e um de modo de permissão. A escolha é feita no lançamento e pode ser trocada depois. Quando o agente suporta troca em voo, a conversa continua; quando não suporta, o app explica o que vai acontecer antes de agir.

**Why this priority**: comparar agentes inclui comparar modelos; mas o lançamento com valores padrão já entrega as P1.

**Independent Test**: com um agente de script controlado declarado no catálogo com troca em voo por comando, trocar o modelo e verificar que o comando chegou ao PTY; com outro declarado sem troca em voo, verificar o diálogo e o relançamento.

**Acceptance Scenarios**:

1. **Given** o diálogo de nova tarefa, **When** o usuário marca agentes, **Then** pode escolher modelo e modo de permissão para cada um, com os valores e o padrão definidos no catálogo.
2. **Given** um agente cuja entrada declara troca de modelo em voo por comando, **When** o usuário troca o modelo no painel e o agente está ocioso, **Then** o app escreve o comando declarado no PTY e o painel passa a exibir o novo modelo.
3. **Given** um agente cuja entrada declara troca por relançamento com retomada, **When** o usuário troca o modelo, **Then** o app avisa que vai encerrar e relançar o processo retomando a conversa, e só age após confirmação.
4. **Given** um agente cuja entrada declara que não suporta troca, **When** o usuário troca o modelo, **Then** o app avisa que a conversa atual será perdida, oferece "Relançar com o novo modelo" ou "Cancelar", e preserva o scrollback anterior acima de um separador.
5. **Given** o usuário escolhe um modo de permissão que desliga todas as confirmações do agente, **When** confirma o lançamento ou a troca, **Then** o app exige confirmação explícita com aviso de risco.

---

### Edge Cases

Cada caso tem um comportamento definido; nenhum deles pode deixar o app travado, a árvore de trabalho principal alterada ou um processo órfão sem registro.

1. **Executável do agente não instalado.** A detecção usa o catálogo: busca no PATH (com PATHEXT no Windows) ou caminho absoluto configurado. No diálogo de nova tarefa o agente aparece como "não encontrado", com o nome do executável procurado, e não pode ser marcado. Se o executável sumir entre a detecção e o lançamento, aquela execução vai para o estado "falhou ao iniciar" com a mensagem "executável <nome> não encontrado", o worktree já criado é mantido para relançamento e as demais execuções da tarefa seguem normalmente.
2. **Repositório com alterações não commitadas no lançamento.** O app detecta por leitura sem lock (`git --no-optional-locks status --porcelain`) e avisa: "O repositório tem N alterações não commitadas. Os worktrees partem de <ponto de partida> e não incluem essas alterações." O usuário escolhe "Lançar mesmo assim" ou "Cancelar". O app nunca faz stash, commit ou checkout no repositório principal.
3. **Worktree já existe de uma execução anterior.** O caminho de cada worktree é derivado do identificador único da execução, então execuções novas não colidem. Se o caminho existir mesmo assim: (a) se pertence a uma execução conhecida, o lançamento daquela execução é recusado com a mensagem "worktree em uso pela execução X"; (b) se é um diretório registrado no git sem execução conhecida, um diretório solto ou um lease sem execução, o app recusa e oferece "Limpar resíduo" num diálogo que mostra o caminho; após confirmação, remove o worktree registrado (com `git worktree remove --force`), o diretório solto e o lease, e roda `git worktree prune`. A limpeza só aceita caminhos dentro da pasta de worktrees do app.
4. **Nome da branch colide.** O nome segue `melinna/<slug-da-tarefa>/<agente>`; se já existir, o app acrescenta o sufixo `-2`, `-3`, … até achar um livre. Nunca sobrescreve nem força uma branch existente. O nome é validado com `git check-ref-format --branch` antes do uso; slugs são reduzidos a `[a-z0-9-]`, com até 40 caracteres.
5. **Processo morre sozinho com o painel fechado.** O hospedeiro de PTY registra código de saída, sinal e horário, grava o restante do scrollback e marca a execução como encerrada. A árvore mostra o estado na hora; ao abrir o painel, o histórico e o código de saída aparecem.
6. **App fechado com agentes vivos.** Diálogo do Cenário 2.1. Em "Manter rodando", o hospedeiro continua vivo e a reabertura reanexa. Em "Encerrar todos", cada processo recebe encerramento gracioso e, após 5 segundos, encerramento forçado da árvore de processos. Se o sistema operacional encerrar a sessão do usuário, os processos morrem com ela e, na reabertura, as execuções sem término registrado aparecem no estado "perdido", com o histórico gravado e a opção "Relançar".
7. **Hospedeiro de PTY morre (falha).** As execuções que ele hospedava ficam no estado "perdido", com o scrollback já gravado preservado. A interface mostra a causa disponível e oferece "Relançar". Um novo hospedeiro é iniciado automaticamente para lançamentos seguintes.
8. **Scrollback cresce sem limite.** O disco guarda no máximo 8 MB por execução, em segmentos de 2 MB; com quatro segmentos cheios, o mais antigo é apagado antes de abrir o próximo. Na reabertura, o painel mostra a linha "histórico anterior descartado (limite de 8 MB)" antes do conteúdo e reinicia os atributos gráficos do terminal para não herdar sequência de escape cortada. Em memória, o xterm guarda 10.000 linhas por painel.
9. **Usuário redimensiona o painel.** O tamanho em colunas e linhas é recalculado ao fim do arrasto, com atraso máximo de 100 ms, e enviado ao PTY. Tamanhos abaixo de 20×5 não são enviados. Painel oculto (tamanho zero) não envia redimensionamento. Ao trocar de layout, todos os painéis visíveis reenviam o tamanho.
10. **Dois painéis tentam escrever no mesmo worktree.** Cada execução é dona exclusiva do seu worktree e uma execução tem no máximo um painel aberto; abrir de novo apenas foca o painel existente. Um registro de posse por worktree, mantido do preparo até a remoção (inclusive entre relançamentos da mesma execução), impede que outra execução seja lançada ou relançada no mesmo caminho; a tentativa é recusada com "worktree em uso pela execução X". Só uma instância do app roda por usuário: abrir de novo apenas foca a janela existente.
11. **Disco sem espaço durante a gravação do scrollback.** O PTY nunca é bloqueado nem encerrado por falha de disco. Ao receber erro de espaço, o app para de gravar o scrollback daquela execução, mantém a saída em memória (limite de 4 MB pendentes, descartando os mais antigos e registrando a lacuna), mostra no painel "Histórico não está sendo gravado: disco cheio" e tenta de novo a cada 30 segundos. Ao voltar, grava uma marca de lacuna e continua. O estado do app (árvore, layout) também usa gravação atômica e, em falha, mantém o arquivo anterior intacto.
12. **Agente pede uma permissão que o modo escolhido nega.** O app não intercepta nem responde prompts do agente: a recusa é tratada pelo próprio agente dentro do PTY, e o usuário vê a mensagem no painel. O app oferece trocar o modo de permissão pelo seletor, aplicando a estratégia de troca declarada no catálogo (em voo, relançamento com retomada, ou relançamento sem retomada com aviso).
13. **Usuário troca o modelo no meio de uma resposta em andamento.** O app considera o agente ocupado se houve saída nos últimos 1,5 segundos. Com o agente ocupado, a troca em voo fica pendente, o seletor mostra "trocar ao ficar ocioso" e o comando só é escrito no PTY após 1,5 segundos sem saída; o usuário pode cancelar a troca pendente. Trocas que exigem relançamento pedem confirmação e avisam que a resposta em andamento será interrompida.
14. **Teto de execuções.** Com 12 execuções vivas, o lançamento de novas é recusado com a mensagem do limite; o diálogo de nova tarefa mostra quantas vagas restam e impede marcar mais agentes do que as vagas.
15. **Repositório inválido ou ponto de partida inexistente.** Validado antes de criar qualquer worktree; nada é criado e a mensagem diz qual valor falhou.
16. **Falha parcial no preparo.** Se a criação do worktree ou da branch de uma execução falhar, apenas aquela execução vai para "falhou ao iniciar", com a causa; o que já foi criado para ela é desfeito; as demais seguem.
17. **Executável é `.cmd` ou `.bat` no Windows.** O motor resolve o alvo real conforme o catálogo (executável nativo ou `node` + script do pacote). Se não conseguir resolver, recusa o lançamento com "não é possível lançar <nome> com segurança" em vez de passar por `cmd.exe`.
18. **Enunciado com caracteres especiais ou muito longo.** Caracteres nulos são recusados. Se o enunciado ultrapassar o limite de linha de comando da plataforma, é entregue pelo PTY em vez de argumento.
19. **Perda do contexto WebGL.** O painel troca para o renderizador DOM sem perder conteúdo nem interatividade.

## Requirements *(mandatory)*

### Functional Requirements

**Catálogo**

- **FR-001**: O sistema DEVE carregar os agentes de um catálogo declarativo embutido e de um catálogo opcional do usuário no diretório de dados do app; entradas do usuário com o mesmo id substituem as embutidas.
- **FR-002**: Cada entrada do catálogo DEVE declarar: id, nome exibido, tipo (agente ou shell), executável, argumentos fixos, como entregar o enunciado (argumento, PTY ou não aceita), lista de modelos e padrão, como passar o modelo, lista de modos de permissão e padrão, como passar o modo, se o modo desliga confirmações, estratégia de troca de modelo e de modo em voo (comando no PTY, relançamento com retomada, sem suporte), como retomar, como detectar a instalação e como resolver lançadores `.cmd`/`.bat` no Windows.
- **FR-003**: O sistema DEVE validar o catálogo ao carregar; entradas inválidas são ignoradas com mensagem na tela de catálogo e log, sem impedir as válidas.
- **FR-004**: Acrescentar um agente DEVE exigir apenas uma entrada nova no catálogo.
- **FR-005**: O catálogo embutido DEVE conter Claude Code, Codex CLI, Gemini CLI e os shells de D4 para a plataforma em uso.

**Tarefas, worktrees e execuções**

- **FR-010**: O usuário DEVE poder criar uma tarefa com grupo, repositório local, ponto de partida (branch, tag ou commit) e enunciado.
- **FR-011**: O sistema DEVE validar que o caminho é um repositório git e que o ponto de partida resolve para um commit, antes de criar qualquer coisa.
- **FR-012**: O sistema DEVE criar uma branch e um worktree por execução, a partir do commit do ponto de partida, fora da árvore de trabalho do usuário, no diretório de dados do app, antes de lançar o processo.
- **FR-013**: O sistema NUNCA DEVE escrever na árvore de trabalho principal, alterar seu índice, trocar sua branch, fazer stash, reset ou checkout nela.
- **FR-014**: O sistema DEVE remover worktree e, por escolha do usuário, a branch, sem deixar diretório nem registro no git, e nunca descartar arquivos não commitados ou commits fora da base sem confirmação explícita (Cenário 3.4a).
- **FR-015**: O sistema DEVE detectar e exibir quantos commits a base avançou desde a criação do worktree.
- **FR-016**: O sistema DEVE tratar os casos de borda 2, 3, 4, 10, 15 e 16 como descrito.

**PTY e hospedeiro**

- **FR-020**: Cada execução DEVE rodar num PTY real, com `TERM=xterm-256color` e `COLORTERM=truecolor`, no diretório do seu worktree.
- **FR-021**: Os PTYs DEVEM pertencer a um processo hospedeiro separado da interface, que sobrevive ao fechamento da janela e aceita reconexão somente do mesmo usuário com um segredo local.
- **FR-022**: O sistema DEVE entregar a entrada do usuário ao PTY e a saída do PTY ao painel, com latência adicional do app abaixo de 30 ms.
- **FR-023**: O sistema DEVE informar ao PTY o novo tamanho em colunas e linhas conforme o caso de borda 9.
- **FR-024**: O sistema DEVE lançar processos sem shell intermediário, com executável resolvido e vetor de argumentos, conforme os casos de borda 17 e 18.
- **FR-025**: O sistema DEVE parar uma execução encerrando o processo e seus descendentes, com encerramento forçado após 5 segundos.
- **FR-026**: O sistema DEVE permitir relançar uma execução encerrada no mesmo worktree.
- **FR-027**: O sistema DEVE limitar execuções vivas a 12 (caso de borda 14).

**Scrollback e reanexação**

- **FR-030**: O sistema DEVE gravar todo byte de saída de cada PTY em disco, em segmentos rotativos conforme D8 e o caso de borda 8.
- **FR-031**: Ao abrir um painel ou reabrir o app, o sistema DEVE reproduzir o scrollback gravado e então emendar a saída ao vivo a partir do deslocamento exato, sem lacuna nem duplicação.
- **FR-032**: O sistema DEVE registrar código de saída, sinal e horário de término de cada processo.
- **FR-033**: O sistema DEVE tratar os casos de borda 5, 6, 7 e 11 como descrito.
- **FR-034**: Sem painel anexado, o sistema DEVE responder às consultas de identificação e de estado do terminal feitas pelo agente, para que ele não fique esperando resposta com o painel ou o app fechado.
- **FR-035**: O sistema DEVE limitar a saída pendente entre o PTY e o painel, pausando a leitura do PTY enquanto o painel não acompanha, sem perder bytes.

**Interface**

- **FR-040**: A árvore DEVE exibir grupos, tarefas e execuções com estado, cor da faixa, agente e modelo, e oferecer abrir, fechar, parar, relançar, remover, criar e renomear.
- **FR-041**: A grade DEVE oferecer os modos Automático, Spotlight, Sidebar e Grade personalizada, com redimensionamento por arrasto e reordenação por arrastar e soltar, persistidos entre sessões.
- **FR-042**: Cada painel DEVE exibir faixa colorida, agente, modelo, modo de permissão, estado e ações, e ter seletores de modelo e de modo de permissão.
- **FR-043**: A troca de modelo e de modo DEVE seguir a estratégia declarada no catálogo e os casos de borda 12 e 13.
- **FR-044**: O painel DEVE oferecer busca no terminal (addon de busca) e abrir links com o navegador padrão do sistema após clique.
- **FR-045**: O diff DEVE seguir a História 4, nos modos lado a lado e unificado.
- **FR-046**: A interface DEVE usar exclusivamente a identidade visual da seção "Identidade visual".

### Identidade visual

Assets em `docs/brand/`: `logo.svg` (512×512), `logo-wordmark.svg` (560×128), `avatar.jpg`. O app usa esses arquivos como estão; ícones do executável são gerados a partir de `docs/brand/logo.svg`.

Conceito: um feixe de luz branco entra num prisma e sai decomposto em seis faixas coloridas. Tagline: "Um feixe entra. Seis saem."

| Papel | Valor |
|-------|-------|
| Fundo do campo | `#07080b` |
| Vinheta do disco (radial, centro 50%/42%) | `#1b2029` → `#12151b` → `#0b0d12` |
| Borda forte | `#262c36` |
| Borda fraca | `#1b212b` |
| Texto e feixe | `#e6e9ef`, núcleo `#ffffff` |
| Cinza do prisma | `#8b95a5` |
| Azul de acento | `#4f8cff` |

Faixas, nesta ordem, identificam as execuções de uma tarefa pela ordem de criação: `#ff3b30` · `#ff9f0a` · `#ffd60a` · `#34c759` · `#0a84ff` · `#bf5af2`. A partir da 7ª execução de uma tarefa, as cores se repetem na mesma ordem acompanhadas do número da execução.

Tipografia: `'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`. Wordmark: o nome em minúsculas, peso 600, `letter-spacing: 2`.

Formas: campo quadrado 512×512 com cantos chanfrados em 36px; disco centrado de raio 236; prisma como triângulo com traço `#e6e9ef` de 2.5px e preenchimento em gradiente de cinza para azul entre 8% e 12% de opacidade; brilho com `feGaussianBlur` de `stdDeviation` entre 3 e 7 combinado com o original. Tema escuro é o primário; a primeira fatia entrega só o tema escuro.

Comportamento desejado da interface, descrito em palavras: árvore de navegação à esquerda, grade de painéis ao centro, barra superior com o wordmark, o seletor de layout e o botão de nova tarefa. Cada painel tem um cabeçalho fino com a faixa colorida à esquerda, o nome do agente, os seletores e as ações, e o terminal ocupando o resto.

### Key Entities

- **AgentDefinition**: entrada do catálogo (ver FR-002). Fonte: embutido ou usuário.
- **Group**: id, nome, ordem, tarefas.
- **Task**: id, grupo, título, enunciado, caminho do repositório, ponto de partida (texto informado e commit resolvido), data de criação.
- **Execution**: id, tarefa, agente, índice de faixa, modelo, modo de permissão, nome da branch, caminho do worktree, commit base, estado, pid, código de saída, sinal, horários de início e término, deslocamento total de bytes do scrollback.
- **ScrollbackLog**: segmentos de bytes por execução com deslocamento inicial e final, marcas de lacuna e de descarte.
- **LayoutState**: modo, ordem dos painéis, painel em foco, proporções da grade personalizada, painéis abertos.
- **WorktreeLease**: posse exclusiva de um caminho de worktree por uma execução.

## Fora do escopo desta fatia

Não entram, não geram tasks e não devem vazar para o código: sincronização em nuvem; controle remoto por rede; sistema de plugins de terceiros; ditado por voz; integração com serviços de música; navegador embutido; grafo de dependências; Pomodoro; proxy de roteamento de modelos; revisão de pull request. Também ficam fora: tema claro, merge ou aplicação automática do resultado de uma execução na branch do usuário, criação de PR, assinatura de código e instalador assinado, validação completa em macOS e Linux, os agentes adiados em D4.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Com 6 execuções de um script de referência, o tempo entre o clique em lançar e o sexto processo vivo é de no máximo 6 segundos num repositório de referência de 1.000 arquivos no Windows. Em repositórios maiores o tempo cresce com o checkout do git, e o painel de cada execução mostra "preparando" até o seu worktree ficar pronto.
- **SC-002**: A latência adicional do app entre tecla e byte no PTY, e entre byte do PTY e pintura no painel, fica abaixo de 30 ms no percentil 95 com 6 painéis ativos.
- **SC-003**: Em 100% dos testes de integração, HEAD, branch, índice e conteúdo da árvore de trabalho principal são idênticos antes e depois de cada fluxo.
- **SC-004**: Após fechar e reabrir o app, 100% dos processos vivos reanexam e o painel mostra o histórico em até 2 segundos, sem bytes perdidos ou duplicados entre o histórico e a saída ao vivo.
- **SC-005**: O scrollback em disco de uma execução nunca passa de 8 MB.
- **SC-006**: Remover uma execução não deixa diretório, entrada em `git worktree list` nem branch (quando o usuário escolhe apagar).
- **SC-007**: Acrescentar um agente novo ao catálogo do usuário, sem alterar código, o faz aparecer e ser lançável.
- **SC-008**: Com 12 execuções vivas, o app (interface + hospedeiro, sem contar os agentes) usa no máximo 800 MB de memória.

## Assumptions

- O usuário tem git 2.30+ no PATH.
- Os agentes do catálogo já estão autenticados pelo usuário fora do app; o app não gerencia credenciais de agente.
- As flags exatas de modelo, permissão, retomada e troca em voo de cada agente são confirmadas contra o `--help` da versão instalada durante a implementação da entrada do catálogo; a spec define o comportamento por capacidade, não por flag.
- Os worktrees ficam no diretório de dados do app, por repositório, e o usuário tem espaço em disco para eles.
- Repositórios com submódulos funcionam como o git os trata em worktrees; inicializar submódulos no worktree fica a cargo do agente ou do usuário.
