# Feature Specification: Interface de git no estilo do IntelliJ

**Feature Branch**: `008-git-estilo-intellij`

**Created**: 2026-10-23

**Status**: Draft

**Input**: User description: "Interface de git no estilo do IntelliJ, por cima da 006-git-na-interface (que mantém as operações de git): barra vertical de ferramentas à esquerda e a janela Commit como painel lateral fixo; no painel, só a aba Commit, com barra de ações, árvore 'Changes' agrupada por repositório com a branch de cada um, grupo 'Unversioned Files', caixas de seleção, Amend, mensagem, 'Commit' e 'Commit and Push…', commit em vários repositórios de uma vez; barra superior com seletor do workspace ativo e seletor de branch, com as ações de branch, fetch, pull, push e histórico no menu da branch. Sem Shelf e sem Stash."

## Contexto

A feature 006 entregou as operações de git (status, commit, descarte, fetch/pull/push, branches, merge, histórico) com uma barra de git sob cada pasta do workspace e uma janela de commit em diálogo. O dono do projeto quer a mesma organização do IntelliJ: uma barra de ferramentas vertical, um painel de Commit fixo ao lado do conteúdo e o seletor de branch na barra superior. Esta feature troca só a forma de usar; as operações, as confirmações e as regras de segurança da 006 continuam valendo.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Painel de Commit fixo, com as alterações de todos os repositórios do workspace (Priority: P1)

O usuário clica no ícone Commit da barra de ferramentas vertical. No lugar da árvore de workspaces abre o painel Commit, que lista as alterações do workspace ativo agrupadas por repositório, com a branch de cada um ao lado, e os arquivos novos num grupo separado. Ele marca o que quer, escreve a mensagem e clica em "Commit"; o diff do arquivo clicado aparece na área principal, ao lado do painel.

**Why this priority**: é a tela que o usuário usa várias vezes por dia e é o motivo da mudança.

**Independent Test**: num workspace com duas pastas git com alterações, abrir o painel Commit, ver as duas pastas com a branch de cada uma, marcar um arquivo de cada, escrever a mensagem e commitar: cada repositório recebe um commit só com o arquivo marcado.

**Acceptance Scenarios**:

1. **Given** a barra de ferramentas vertical, **When** o usuário clica no ícone Commit, **Then** o painel Commit ocupa o lugar da árvore (o mesmo lugar dos painéis Workspaces e Arquivos) e o ícone fica destacado; clicar de novo no ícone fecha o painel.
2. **Given** o painel Commit, **When** ele abre, **Then** mostra o nó "Changes N files" com um nó por repositório do workspace ativo (nome da pasta, quantidade de arquivos e a branch atual ao lado) e, separado, o nó "Unversioned Files N files" com os arquivos novos ainda não rastreados.
3. **Given** um nó de repositório, **When** o usuário o expande, **Then** vê as pastas e os arquivos alterados em árvore, cada um com o tipo de alteração indicado (cor ou rótulo: alterado, novo, removido, renomeado, conflito).
4. **Given** as caixas de seleção, **When** o usuário marca ou desmarca um grupo, um repositório, uma pasta ou um arquivo, **Then** todos os filhos seguem a marca e os pais mostram estado parcial quando só parte dos filhos está marcada.
5. **Given** o painel aberto pela primeira vez, **When** carrega, **Then** os arquivos alterados vêm marcados e os do grupo "Unversioned Files" vêm desmarcados, como no IntelliJ.
6. **Given** um arquivo da árvore, **When** o usuário clica nele (ou usa "Ver diff" na barra de ações), **Then** o diff aparece na área principal ao lado do painel, com o painel ainda aberto; duplo clique abre o arquivo no editor do app.
7. **Given** arquivos marcados em dois repositórios e uma mensagem, **When** o usuário clica em "Commit", **Then** cada repositório recebe um commit com a mesma mensagem e só com os seus arquivos marcados; o painel se atualiza e a mensagem é limpa.
8. **Given** o commit de vários repositórios, **When** um deles falha (hook, identidade, lock), **Then** os que já foram commitados continuam commitados, o que falhou mantém o índice como estava, e o painel mostra qual repositório falhou e por quê, com a mensagem preservada.
9. **Given** "Commit and Push…", **When** os commits dão certo, **Then** o push é feito em cada repositório commitado (nenhum push se algum commit falhou), pedindo as confirmações de cada um (push na branch principal, publicar branch nova) antes de começar.
10. **Given** a caixa "Amend", **When** o usuário a marca, **Then** a mensagem do último commit é carregada quando a caixa de mensagem está vazia; o amend vale para os repositórios com arquivos marcados ou, sem nenhum marcado, para o único repositório do workspace (com vários, o usuário escolhe qual).
11. **Given** um commit já publicado, **When** o usuário faz amend, **Then** aparece a confirmação da 006 antes de reescrever.
12. **Given** a barra de ações do painel, **When** o usuário usa "Atualizar", "Reverter" (rollback dos marcados, com a confirmação que lista a ação por arquivo), "Ver diff", "Expandir tudo" ou "Recolher tudo", **Then** a ação correspondente acontece.
13. **Given** agentes rodando no workspace ativo, **When** o painel está aberto, **Then** aparece o aviso de que eles podem estar escrevendo nos arquivos.
14. **Given** um repositório em merge, **When** o painel abre, **Then** esse repositório mostra "merge em andamento", os conflitos com ação para abrir no editor e marcar como resolvido, e o commit dele exige todos os arquivos (regra da 006), com a mensagem do merge sugerida.
15. **Given** a janela ganha o foco ou uma operação de git termina, **When** o painel está aberto, **Then** as alterações são relidas, mantendo as marcas dos arquivos que continuam alterados.

---

### User Story 2 - Barra superior com o workspace ativo e o seletor de branch (Priority: P1)

Na barra superior, o usuário vê o workspace ativo (com o ícone de iniciais) e, ao lado, a branch atual com ▾. No menu da branch ficam as ações de git: trocar, criar e mesclar branches, fetch, pull, push e histórico. Com várias pastas git no workspace, o menu lista cada repositório com a sua branch.

**Why this priority**: substitui a barra de git debaixo do workspace; sem ela, fetch, pull, push e branches ficam sem lugar.

**Independent Test**: num workspace de uma pasta, abrir o menu da branch, criar uma branch nova e ver o nome dela na barra; fazer push pelo menu e ver ↑0. Num workspace de duas pastas, ver as duas branches no menu.

**Acceptance Scenarios**:

1. **Given** workspaces abertos, **When** o usuário abre o seletor de workspace ▾ da barra superior, **Then** escolhe o workspace ativo; o painel Commit e o seletor de branch passam a mostrar esse workspace, e a escolha é lembrada entre aberturas.
2. **Given** um workspace de uma pasta git, **When** a barra é mostrada, **Then** o seletor de branch exibe a branch atual (ou "HEAD solto em <sha>") e, quando houver upstream, ↑ e ↓.
3. **Given** um workspace com várias pastas git, **When** a barra é mostrada, **Then** o seletor exibe a branch do repositório principal com a indicação de que há outros, e o menu lista cada repositório com a sua branch, ↑/↓ e um submenu de ações.
4. **Given** o menu de um repositório, **When** o usuário abre, **Then** vê "Nova branch…", as branches locais (a atual marcada) e remotas, e para cada branch "Trocar" e "Mesclar na atual"; além de "Fetch", "Pull", "Push…" e "Histórico".
5. **Given** "Fetch", "Pull" ou "Push…", **When** o usuário escolhe, **Then** a operação roda com o progresso e o botão de cancelar visíveis na barra superior, e as confirmações e mensagens de erro da 006 valem igual.
6. **Given** um workspace com várias pastas git, **When** o usuário escolhe "Fetch" ou "Pull" no topo do menu (fora dos repositórios), **Then** a operação roda em todos os repositórios, um depois do outro, e o resultado de cada um aparece ao final.
7. **Given** uma pasta sem git, **When** o menu é aberto, **Then** ela não aparece; um workspace sem nenhuma pasta git mostra o seletor de branch desabilitado com "Sem git".
8. **Given** uma pasta em rebase ou cherry-pick iniciado fora do app, **When** o menu é aberto, **Then** o repositório mostra o estado e a instrução para concluir fora do app, e as ações que mudam a branch ficam desabilitadas.
9. **Given** um merge com conflitos (pelo menu ou por um pull), **When** termina, **Then** o painel Commit abre mostrando os conflitos daquele repositório.

---

### User Story 3 - Barra de ferramentas vertical (Priority: P2)

À esquerda da janela fica uma faixa vertical de ícones, como no IntelliJ: Workspaces, Arquivos e Commit em cima; os demais painéis do app embaixo. Cada ícone abre o painel correspondente no lugar lateral; a barra lateral deixa de ter as abas "Workspaces" e "Arquivos" no topo.

**Why this priority**: organiza os painéis no modelo que o usuário conhece; o painel Commit funciona sem ela por atalho, mas a navegação fica pior.

**Independent Test**: clicar em Workspaces, Arquivos e Commit e ver o painel lateral trocar; clicar no ícone ativo e ver a barra lateral se recolher; reabrir o app e ver o mesmo painel.

**Acceptance Scenarios**:

1. **Given** a barra vertical, **When** o usuário passa o mouse num ícone, **Then** vê o nome do painel e o atalho dele.
2. **Given** um painel aberto, **When** o usuário clica no ícone de outro painel, **Then** o painel lateral troca; clicando no ícone do painel aberto, a barra lateral se recolhe, e clicando de novo ela volta.
3. **Given** o painel Commit, **When** há alterações no workspace ativo, **Then** o ícone mostra um indicador com a quantidade de arquivos alterados.
4. **Given** o painel escolhido e a largura da barra lateral, **When** o app é fechado e reaberto, **Then** voltam como estavam.
5. **Given** a biblioteca de prompts e o catálogo de agentes, **When** o usuário procura onde abri-los, **Then** eles também têm ícones na parte de baixo da barra vertical.

### Edge Cases

- Workspace ativo removido da lista: o app escolhe o próximo da lista; sem nenhum, o painel Commit mostra "Abra um workspace" e o seletor de branch some.
- Workspace sem pastas git: o painel Commit mostra "Nenhum repositório git neste workspace".
- Repositório sem alterações: aparece em "Changes" com "0 files" apenas se o workspace tiver mais de um repositório; com um só, o painel mostra "Nenhuma alteração".
- Mais de 500 arquivos alterados num repositório: a árvore continua respondendo (expandir/recolher e marcar em menos de 200 ms) e abre recolhida.
- Pasta de workspace indisponível (feature 003): não aparece no painel nem no menu da branch.
- Commit sem nenhum arquivo marcado e sem amend: "Commit" desabilitado com a dica "Marque ao menos um arquivo".
- Mensagem vazia: "Commit" desabilitado com a dica "Escreva a mensagem".
- Arquivo marcado em "Unversioned Files": entra no commit do repositório dele como arquivo novo.
- Arquivo que deixou de estar alterado entre a leitura e o commit: o commit daquele repositório é recusado com a mensagem da 006 e a lista é relida.
- Operação de rede rodando em um repositório: as operações de rede e o commit daquele repositório ficam desabilitados até terminar ou ser cancelada; os outros repositórios seguem livres.
- "Commit and Push…" em que um push precisa de confirmação: as confirmações aparecem uma por repositório; recusar uma não desfaz os commits feitos e não impede os outros pushes.
- Reverter com arquivos de "Unversioned Files" marcados: a confirmação da 006 lista esses arquivos com a ação "apagar"; nada é apagado sem confirmar.
- Duplo clique num arquivo removido: nada abre e a dica diz "arquivo removido"; o diff continua disponível com um clique.
- Diff de arquivo binário: mostra os tamanhos antes e depois; diff acima de 1 MB: "grande demais para mostrar".
- Troca do workspace ativo durante uma sequência de commit ou push: o seletor de workspace fica desabilitado até a sequência terminar.
- "Fetch todos" e "Pull todos": rodam um repositório por vez, nunca em paralelo.
- App fechado no meio de uma sequência: a operação em curso termina ou é interrompida como na 006; os repositórios seguintes não rodam; ao reabrir, o painel mostra o estado real de cada repositório.
- "Commit and Push…" em que um commit falha: nenhum push é feito; o usuário corrige e repete.
- Preferência guardada inválida ou indisponível (painel, workspace ativo): o app usa o padrão (painel Workspaces, primeiro workspace da lista).
- Atalhos de painel com o terminal em foco: a tecla segue para o terminal (readline usa Alt+dígito); os atalhos valem com o foco fora do terminal.
- Branch com nome longo: a barra superior abrevia com reticências e mostra o nome inteiro na dica.
- Janela estreita: a barra superior esconde primeiro a tagline e depois o nome do workspace, mantendo os seletores.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A janela MUST ter uma barra de ferramentas vertical à esquerda com ícones para Workspaces, Arquivos e Commit (em cima) e para biblioteca de prompts e catálogo de agentes (embaixo), cada um com nome e atalho na dica.
- **FR-002**: Clicar no ícone de um painel MUST abrir esse painel no lugar lateral; clicar no ícone do painel aberto MUST recolher a barra lateral. O painel escolhido e a largura MUST ser lembrados entre aberturas.
- **FR-003**: O painel Commit MUST listar as alterações do workspace ativo em "Changes", agrupadas por repositório (nome da pasta, quantidade e branch atual), e os arquivos não rastreados em "Unversioned Files", também agrupados por repositório quando houver mais de um.
- **FR-004**: A árvore MUST ter caixas de seleção em grupo, repositório, pasta e arquivo, com estado parcial nos pais; alterados vêm marcados e não rastreados desmarcados na primeira carga; ao reler, MUST manter as marcas dos arquivos que continuam alterados.
- **FR-005**: Clicar num arquivo MUST mostrar o diff dele na área principal, ao lado do painel; duplo clique MUST abrir o arquivo no editor do app.
- **FR-006**: "Commit" MUST criar um commit por repositório com arquivos marcados, com a mesma mensagem, em sequência; uma falha MUST ser mostrada com o nome do repositório, sem desfazer os commits já feitos e mantendo a mensagem na caixa.
- **FR-007**: "Commit and Push…" MUST, depois que todos os commits derem certo, iniciar o push de cada repositório commitado, pedindo as confirmações de cada um antes do respectivo push.
- **FR-008**: "Amend" MUST carregar a mensagem do último commit quando a caixa estiver vazia e valer para os repositórios com arquivos marcados; sem marcados e com mais de um repositório, MUST pedir que o usuário escolha o repositório.
- **FR-009**: A barra de ações do painel MUST oferecer Atualizar, Reverter (rollback dos marcados com a confirmação por arquivo da 006), Ver diff, Expandir tudo e Recolher tudo.
- **FR-010**: Repositórios em merge MUST mostrar os conflitos com "Abrir no editor" e "Marcar como resolvido" e exigir todos os arquivos daquele repositório no commit, sugerindo a mensagem do merge.
- **FR-011**: A barra superior MUST mostrar o seletor do workspace ativo e o seletor de branch; o workspace ativo MUST ser lembrado entre aberturas.
- **FR-012**: O menu da branch MUST listar cada repositório git do workspace com branch, ↑/↓ e as ações: nova branch, trocar, mesclar na atual, fetch, pull, push e histórico; com mais de um repositório, MUST oferecer também fetch e pull de todos, em sequência.
- **FR-013**: Operações de rede MUST mostrar progresso e "Cancelar" na barra superior e manter as confirmações e mensagens de erro da 006.
- **FR-014**: A barra de git debaixo de cada workspace e a janela de commit em diálogo da 006 MUST ser removidas; nenhuma operação de git pode ficar sem acesso pela nova interface.
- **FR-015**: As alterações MUST ser relidas quando a janela ganha o foco e ao fim de cada operação de git, sem leitura periódica.
- **FR-016**: Todas as regras da 006 MUST continuar: escrita só por ação explícita, confirmação nas operações que podem perder trabalho, credenciais delegadas ao git, aviso de agente vivo.

### Key Entities

- **Workspace ativo**: o workspace escolhido na barra superior; define o que o painel Commit e o seletor de branch mostram.
- **Painel lateral**: Workspaces, Arquivos ou Commit, com a barra lateral aberta ou recolhida e a largura.
- **Seleção do commit**: por repositório, os arquivos marcados; sobrevive à releitura enquanto o arquivo continuar alterado.
- **Repositório do workspace**: pasta git do workspace com o estado lido pela 006 (branch, ↑/↓, estado, alterações).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Abrir o painel Commit e ver as alterações de um workspace de até 3 repositórios com 500 arquivos no total leva menos de 2 segundos.
- **SC-002**: Um único clique em "Commit" gera os commits de todos os repositórios com arquivos marcados, verificado em teste com 2 repositórios.
- **SC-003**: Todas as operações de git da 006 (16 canais) continuam acessíveis pela nova interface, verificado por teste de tela por operação.
- **SC-004**: Marcar ou desmarcar um grupo com 500 arquivos atualiza a árvore em menos de 200 ms.
- **SC-005**: O painel lateral, a largura e o workspace ativo voltam iguais em 100% das reaberturas do app.

## Assumptions

- O núcleo e os canais de IPC da 006 continuam; esta feature é de interface.
- Commit em vários repositórios é uma sequência de commits independentes; não existe "commit atômico" entre repositórios.
- Shelf, Stash, changelists, histórico local e anotação (blame) ficam fora desta feature.
- A barra vertical traz só os painéis que o app já tem; painéis novos (como execução, da 007) entram nela quando forem feitos.
- Os nomes "Changes", "Unversioned Files", "Commit", "Commit and Push…" e "Amend" ficam em inglês, como no IntelliJ que o usuário usa; os demais textos seguem em pt-BR.
