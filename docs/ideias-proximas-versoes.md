# Próximas versões do Melinna: ideias validadas

Entrada para o `/planejar`. Cada bloco abaixo vira uma feature própria do Spec Kit, na ordem sugerida.
Estado de partida: o MVP (feature 001 + ajustes de 22/10/2026), em que cada workspace é **uma** pasta e
os terminais rodam direto nela.

---

## 1. Workspace com vários projetos (v1.x, próxima feature)

### Ideia
Criar um workspace com nome próprio e várias pastas (projetos). Um agente aberto nesse workspace enxerga
e edita todos os projetos na mesma conversa, para tarefas que atravessam front, back, bibliotecas etc.

### Validação
**Viável e de custo médio.** Os agentes de CLI já suportam pastas extras sem truque:

| Agente | Como recebe pastas extras | Situação |
|---|---|---|
| Claude Code | `--add-dir <pasta>` (repetível) | confirmado |
| Gemini CLI | `--include-directories <a,b>` | conferir na versão instalada |
| Codex CLI | `--add-dir <pasta>` | conferir na versão instalada |
| Shells | não se aplica | abrem só na pasta principal |

O terminal roda na **pasta principal** (é ela que guarda o histórico de conversas do agente) e as demais
entram como extras. Isso fica declarado no catálogo (`agents.json`), como já acontece com modelo e
permissão: acrescentar suporte a um agente continua sendo editar o catálogo, não o motor.

### Escopo
- Modelo de dados: `Group` passa de `repoPath` único para uma lista de pastas com uma principal.
  Migração automática: workspaces atuais viram workspaces de uma pasta.
- Tela "Novo workspace": nome + "Adicionar pasta…" (várias) + escolha da principal.
- Em workspaces existentes: adicionar e remover pastas, trocar a principal.
- Lançamento: catálogo ganha um campo opcional de pastas extras; o plano de lançamento monta os argumentos.
- Explorador de arquivos e decoração de git: uma raiz por pasta do workspace.
- Remoção continua sem apagar nenhuma pasta.

### Decisões em aberto
1. A pasta principal é a primeira adicionada ou escolhida pelo usuário?
2. A mesma pasta pode estar em dois workspaces?
3. Sessões já abertas ganham as pastas novas na hora (exige relançar o agente) ou só as novas sessões?

### Riscos
- Agente sem suporte a pastas extras: o app precisa dizer isso, não falhar calado.
- Comandos de git no explorador passam a rodar por pasta (custo de desempenho com muitos projetos).

---

## 2. Orquestrador de prompts (v2)

### Ideia
Transformar o Melinna num orquestrador: guardar prompts, mandar o mesmo prompt para várias IAs/sessões,
encadear etapas (o resultado de uma vira entrada da outra) e acompanhar tudo num lugar só.

### Validação
**Viável, mas em camadas.** O ponto técnico central: hoje a conversa acontece num terminal interativo, e a
saída de um PTY é texto com cores e redesenho de tela, ruim de ler por máquina. Para encadear etapas de
forma confiável, as etapas automáticas devem usar o **modo não interativo** dos agentes (por exemplo,
`claude -p "<prompt>" --output-format stream-json`), que devolve resultado estruturado. Os terminais
interativos continuam sendo o lugar de conversar e de intervir.

### Escopo sugerido, do mais barato ao mais caro
1. **Biblioteca de prompts**: salvar, nomear, organizar por workspace, com variáveis (`{{arquivo}}`,
   `{{branch}}`, `{{tarefa}}`) preenchidas na hora de usar.
2. **Enviar para várias sessões**: escolher terminais abertos e mandar o mesmo prompt a todos
   (o motor já entrega prompt via argumento ou via PTY).
3. **Fila por sessão**: enfileirar prompts para um agente, enviados quando ele fica ocioso
   (o app já detecta ocioso/rodando).
4. **Pipelines**: etapas em sequência ou paralelas, cada uma com agente, prompt e pastas, rodando no modo
   não interativo, com o resultado de cada etapa visível e reaproveitável na seguinte.
5. **Histórico e comparação**: o que cada etapa recebeu e devolveu, custo e tempo quando o agente informar.

### Decisões em aberto
- Formato do pipeline: definido na interface (visual) ou em arquivo versionado no projeto (YAML/JSON)?
- Onde guardar a biblioteca: global, por workspace ou dentro do repositório (compartilhável com a equipe)?
- Aprovação humana entre etapas: sempre, opcional por etapa ou nunca?

### Riscos
- Modo não interativo e formato de saída diferem entre agentes: cada um precisa de um adaptador no catálogo.
- Etapas automáticas com permissões amplas: precisam dos mesmos avisos de modo perigoso que já existem.

---

## 3. IDE: rodar, depurar e trabalhar no projeto (v2)

### Ideia
Ter no Melinna o ciclo do VS Code: editar, rodar o projeto, depurar, ver erros, sem trocar de ferramenta.

### Validação
**A mais cara das três, e com risco de reinventar o VS Code.** Recomendação: entregar em níveis e só subir
de nível se o anterior provar valor.

| Nível | O que entrega | Custo | Base técnica |
|---|---|---|---|
| A. Rodar | detectar e rodar comandos do projeto (scripts do `package.json`, `mvn`, `gradle`, `docker compose`) num terminal do próprio app, com "rodar de novo" e "parar" | baixo | o motor de PTY já existe |
| B. Abrir fora | botões "Abrir no VS Code" / "Abrir no IntelliJ" no workspace e no arquivo, na linha certa | baixo | linha de comando das IDEs |
| C. Editor de verdade | busca em todos os arquivos, ir para definição, erros e autocompletar | médio a alto | servidores de linguagem (LSP) por linguagem |
| D. Depurar | pontos de parada, passo a passo, variáveis | alto | protocolo de depuração (DAP) e um adaptador por linguagem |
| E. Git visual | commit, push, pull, fetch, merge, branches e histórico pela interface | médio | ver bloco 5 |

Sugestão para a v2: **A + B + E**, com C só para busca global. **D** fica para uma v3 ou é coberto pelo
"Abrir no VS Code/IntelliJ", que já depuram bem Java/Spring e Node.

### Decisões em aberto
- Quais linguagens contam primeiro (Java/Spring, NestJS/Node, front)? Isso define LSP e depuração.
- O editor atual (CodeMirror) basta, ou a v2 troca pelo Monaco (o editor do VS Code)? Trocar facilita
  recursos de IDE, mas é uma migração de componente e de testes.

### Riscos
- Escopo sem fim: cada linguagem traz o seu servidor de linguagem e o seu depurador.
- Peso do app: LSP e depuração rodam processos extras por projeto.

---

## 4. Imagens no chat do terminal (v2)

### Ideia
Colar (Ctrl+V), arrastar ou anexar imagens — prints de tela, mockups, erros — direto no terminal do
agente, como já se faz no Claude Code rodando num terminal comum.

### Validação
**Viável e de custo baixo a médio.** Um terminal só transporta texto: a imagem não "entra" no PTY. Os
agentes resolvem isso de dois jeitos, e o Melinna pode aproveitar os dois:

1. **O agente lê a área de transferência sozinho.** O Claude Code, ao receber a tecla de colar, busca a
   imagem na área de transferência do sistema. Hoje o painel do Melinna trata o Ctrl+V como colagem de
   texto (xterm.js) e a imagem se perde. Basta deixar a tecla chegar ao agente quando a área de
   transferência tiver imagem e nenhum texto.
2. **O agente recebe o caminho do arquivo.** Para colar, arrastar ou anexar: o Melinna grava a imagem num
   arquivo (por exemplo, `userData/anexos/<sessão>/<data>.png`) e digita o caminho entre aspas no
   prompt. Claude Code, Codex e Gemini aceitam caminho de imagem no prompt (no Gemini com `@caminho`);
   o formato fica declarado por agente no catálogo.

### Escopo
- Colar imagem no painel (Ctrl+V) e arrastar arquivos de imagem para o painel. Inclui print de tela:
  PrtSc ou Win+Shift+S no Windows (e a captura do sistema no Linux) põem a imagem na área de
  transferência, e o Ctrl+V no painel a envia ao agente.
- Botão de anexar no painel ou na linha da execução, com o diálogo de arquivo.
- Prévia pequena da imagem anexada antes de enviar, com opção de cancelar.
- Catálogo: campo opcional por agente dizendo como ele recebe imagem (tecla de colar, caminho simples,
  `@caminho`); agentes sem suporte mostram aviso em vez de colar lixo no terminal.
- Limpeza dos anexos quando a sessão é removida.

### Decisões em aberto
- Onde guardar os anexos: pasta do app (privada) ou dentro do projeto (por exemplo, `.melinna/anexos`)?
- Limite de tamanho e formatos aceitos (PNG, JPG, GIF, WebP, PDF?).

### Riscos
- Comportamento de colar muda entre versões dos agentes e entre Windows e Linux: precisa de teste por
  agente e por sistema.
- Imagens podem conter dados sensíveis: os anexos não devem ir para o git do projeto sem o usuário querer.

---

## 5. Git na interface, no estilo do IntelliJ (v2)

### Ideia
Fazer commit, push, pull, fetch, merge e trocar de branch sem sair do Melinna, com uma janela de commit
como a do IntelliJ: lista de arquivos alterados com caixas de seleção, campo de mensagem e botões
"Commit" e "Commit and Push".

### Validação
**Plugin do IntelliJ: não é viável.** Plugins do IntelliJ são feitos em Java/Kotlin para a plataforma da
JetBrains e só rodam dentro das IDEs dela; o Melinna é Electron, não tem como carregá-los. Plugins do
VS Code também não rodam fora do VS Code sem reimplementar a API dele.

**Git próprio: viável e de custo médio.** O app já chama o `git` da máquina com segurança (sem shell) e já
lê o status por arquivo para decorar o explorador. O caminho é construir a interface em cima disso, usando
o git instalado e as credenciais que o usuário já configurou (Git Credential Manager no Windows, SSH etc.).

### Escopo
- **Janela de commit**: arquivos alterados agrupados por pasta, caixa de seleção por arquivo (stage),
  diff ao clicar no arquivo, campo de mensagem, "Commit" e "Commit and Push", opção de "amend".
- **Barra de git** no workspace: branch atual, commits à frente/atrás do remoto, botões de fetch, pull e
  push com o resultado visível (e o erro do git, quando houver).
- **Branches**: listar, criar, trocar e mesclar (merge) uma branch na atual; conflitos listados por arquivo,
  com "abrir no editor" e "marcar como resolvido".
- **Histórico**: lista de commits da branch com autor, data e arquivos de cada um.
- **Integração com os agentes**: botão "pedir mensagem de commit ao agente" usando o diff selecionado.
- Workspace multiprojeto (bloco 1): uma barra de git por pasta do workspace.

### Decisões em aberto
- Pull com merge ou com rebase por padrão?
- Push direto para a branch principal: permitir, avisar ou bloquear?
- Resolver conflitos dentro do Melinna (editor de 3 vias) ou só listar e abrir no editor / IntelliJ?

### Riscos
- Credenciais e autenticação variam (HTTPS com token, SSH, 2FA): o app deve deixar o git do sistema
  pedir credenciais, nunca guardá-las.
- Operações destrutivas (reset, force push, descartar alterações) precisam de confirmação explícita.
- Agentes rodando na mesma pasta podem estar alterando arquivos durante o commit: avisar quando houver
  execução viva no workspace.

---

## Ordem sugerida para o `/planejar`

1. `003-workspace-multiprojeto`: bloco 1 (pequeno, desbloqueia tarefas entre projetos).
2. `004-orquestrador-prompts`: bloco 2, itens 1 a 3 primeiro; pipelines numa segunda fatia.
3. `005-imagens-no-terminal`: bloco 4 (pequeno e de uso diário; pode vir antes do orquestrador).
4. `006-git-na-interface`: bloco 5 (commit, push, pull, fetch, merge e branches).
5. `007-ide-rodar`: bloco 3, níveis A e B.
6. Depois de usar: decidir sobre LSP (nível C) e depuração (nível D).

Antes de planejar, vale validar no MVP: o fluxo direto na pasta, o "+" de sessão, o redimensionamento e o
AppImage no Linux.
