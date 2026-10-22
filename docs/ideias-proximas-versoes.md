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
| E. Git visual | stage, commit, diff e histórico pela interface | médio | o app já lê o status do git |

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

## Ordem sugerida para o `/planejar`

1. `003-workspace-multiprojeto`: bloco 1 (pequeno, desbloqueia tarefas entre projetos).
2. `004-orquestrador-prompts`: bloco 2, itens 1 a 3 primeiro; pipelines numa segunda fatia.
3. `005-ide-rodar-e-git`: bloco 3, níveis A, B e E.
4. Depois de usar: decidir sobre LSP (nível C) e depuração (nível D).

Antes de planejar, vale validar no MVP: o fluxo direto na pasta, o "+" de sessão, o redimensionamento e o
AppImage no Linux.
