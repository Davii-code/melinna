<!--
Sync Impact Report
- 1.0.0 → 1.1.0: Princípio IX ganha exceção registrada para verificação dos bloqueantes técnicos da feature 001 no repositório de referência, sem cópia de código.
- Version change: (template) → 1.0.0
- Principles added: I–X (all new)
- Sections added: Restrições técnicas, Fluxo de desenvolvimento, Governança
- Templates requiring updates: none (plan/spec/tasks templates are generic and compatible)
- Follow-up TODOs: none
-->

# Constitution do Melinna Desk

Workspace desktop local-first para rodar vários agentes de código de CLI em paralelo, cada um num terminal PTY vivo e isolado num git worktree próprio. Pacote e binário: `melinna-desk`. Marca: Melinna. Tagline: "Um feixe entra. Seis saem."

## Princípios

### I. Agente é processo, não biblioteca

Um agente é um executável externo lançado num PTY. O app não importa SDK nem biblioteca de nenhum agente. Os agentes vivem num catálogo declarativo (dados), que define o executável, os argumentos, como passar o modelo, como passar o modo de permissão, como trocar o modelo em voo e como detectar a instalação. Acrescentar um agente é acrescentar uma entrada no catálogo; o motor não muda. Se um agente novo exigir mudança no motor, a mudança tem de ser genérica (uma nova capacidade declarável no catálogo) e não um caso especial por nome de agente.

### II. Isolamento por worktree (INEGOCIÁVEL)

Todo trabalho de agente acontece numa branch e num git worktree próprios, criados antes do lançamento. A árvore de trabalho principal do repositório do usuário nunca é escrita, nunca tem arquivos criados, nunca recebe stash, reset, checkout ou troca de branch, em nenhum fluxo. Leituras do repositório principal usam comandos que não tocam o índice (`git --no-optional-locks`). A remoção de um worktree não deixa diretório, registro em `git worktree list` nem branch órfã, exceto quando o usuário escolhe manter a branch.

### III. O PTY é a fonte da verdade da sessão

Cada execução é um pseudoterminal real (ConPTY no Windows). O processo do agente pertence a um processo hospedeiro de PTY separado da interface: fechar um painel não mata o agente; fechar a janela do app não mata o agente, a menos que o usuário escolha encerrá-los; fechar o app nunca perde o scrollback, que é gravado em disco. A interface é uma visão do PTY, nunca o dono dele.

### IV. Núcleo independente da camada de desktop

A orquestração (catálogo, tarefas, execuções, worktrees, scrollback, layout, persistência) vive em `src/core` e não importa Electron, node-pty, React nem nada de `src/main`, `src/preload` ou `src/renderer`. O núcleo fala com o mundo por portas (interfaces) e recebe adaptadores por injeção. Um teste automatizado de arquitetura reprova qualquer import proibido. Isso permite um daemon e uma CLI depois sem reescrever o núcleo.

### V. Testes para todo comportamento novo ou alterado (INEGOCIÁVEL)

Nenhum comportamento entra sem teste que o cubra. Os testes de cada história são escritos antes da implementação e falham antes dela. Nunca se enfraquece, apaga, pula (`skip`, `only`, `todo`) ou relaxa um teste, nem se muda um assert para passar. Bug corrigido ganha teste que o reproduz.

### VI. Entregável completo

Sem `TODO`, `FIXME`, placeholder, stub de produção ou código comentado. Erros e casos de borda são tratados no próprio entregável, com mensagem compreensível para o usuário e log estruturado para diagnóstico.

### VII. Sem surpresas de dependência, contrato ou arquitetura

Nenhuma dependência nova, nenhuma mudança de contrato público (APIs do núcleo, protocolo do hospedeiro de PTY, canais de IPC, esquema do catálogo, formato de estado em disco) e nenhuma decisão de arquitetura não prevista no plan entra sem aprovação explícita do dono do projeto. As dependências aprovadas estão listadas no plan da feature.

### VIII. Execução segura de processos

Processos são lançados com executável resolvido e vetor de argumentos, nunca por uma string interpretada por shell. Texto do usuário e valores do catálogo nunca passam por `cmd.exe`, `sh -c` ou equivalente. No Windows, arquivos `.cmd` e `.bat` não são lançados com argumentos derivados de entrada do usuário; o motor resolve o alvo real (executável nativo ou `node` + script). Conteúdo de PTY e texto de tarefa não vão para logs.

### IX. Independência de código e de marca em relação à referência de inspiração (INEGOCIÁVEL)

O produto se inspira no layout e nas funcionalidades de um projeto público licenciado sob AGPL-3.0-or-later, cuja marca não é coberta pela licença. Neste projeto:

- Não se copia, transcreve nem parafraseia código daquele repositório, e não se clona nem se lê o seu código-fonte para derivar implementação.
- Não se usa o nome, o logo, os ícones nem qualquer asset daquele projeto em código, interface, documentação, metadados, nomes de pacote ou de arquivo.
- As ideias de interface e de produto são reimplementadas do zero, com decisões próprias, e descritas em palavras nas specs, sem apontar para arquivos do original.
- **Exceção registrada (v1.1.0, 2026-10-20, autorizada pelo dono do projeto):** o repositório de referência pode ser clonado fora da pasta do projeto e lido somente para verificar se os bloqueantes técnicos da feature 001 (canal MessagePort entre principal e página, respostas a consultas de terminal sem painel, limpeza de resíduo de worktree, posse de worktree e instância única) aparecem lá e como se manifestam. Continua proibido copiar, transcrever ou parafrasear código, nomes de símbolos ou estrutura de arquivos; as conclusões entram nas specs só como descrição de comportamento, e cada decisão segue justificada por documentação pública das bibliotecas usadas. O clone não entra no repositório do projeto e é apagado após a verificação.

### X. Identidade visual própria e única

A interface usa exclusivamente a marca Melinna definida em `docs/brand/` (`logo.svg`, `logo-wordmark.svg`, `avatar.jpg`), com a paleta, a tipografia e as seis cores de faixa fixadas na spec. Tema escuro é o primário. As seis faixas identificam execuções na interface, sempre na mesma ordem.

## Restrições técnicas

- Plataforma da primeira fatia: Windows 10 1809+ validado (ConPTY). macOS e Linux compilam no CI e não podem ser impedidos por suposições de plataforma no código; validação completa na fatia seguinte.
- Stack: TypeScript estrito, Electron, node-pty, @xterm/xterm. Lista completa e fechada de dependências no plan.
- Local-first: nenhum dado sai da máquina por iniciativa do app. Sem telemetria.
- Limites: alvo de 6 execuções simultâneas, teto duro de 12. Scrollback em disco limitado a 8 MB por execução em segmentos rotativos de 2 MB; 10.000 linhas em memória por painel.
- Estado em disco é gravado de forma atômica (arquivo temporário + renomeação) e versionado por esquema.

## Fluxo de desenvolvimento

- Toda feature passa por spec → plan → tasks antes de código.
- Tasks são pequenas, citam os arquivos que tocam, incluem os próprios testes e são verificáveis isoladamente.
- Antes de escrever, lê-se o código vizinho da mesma camada e seguem-se os padrões (nomes, erros, logs, injeção de dependência, testes).
- Build, testes, lint, testes de tela e revisão são disparados pelo dono do projeto; não são tasks.

## Governança

Esta constitution prevalece sobre qualquer outra prática do projeto. Emendas exigem justificativa escrita, aprovação do dono do projeto e incremento de versão semântico: MAJOR para remoção ou redefinição incompatível de princípio, MINOR para princípio ou seção nova, PATCH para esclarecimento. Plans e revisões verificam conformidade com cada princípio; violação só entra registrada em "Complexity Tracking" do plan, com motivo e alternativa rejeitada.

**Version**: 1.1.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-20
