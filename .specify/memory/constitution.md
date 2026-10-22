# Constitution do Melinna Desk

Workspace desktop local-first para rodar vários agentes de código de CLI em paralelo, cada um num terminal PTY vivo, direto na pasta do projeto. Pacote e binário: `melinna-desk`. Marca: Melinna. Tagline: "Um feixe entra. Seis saem."

## Princípios

### I. Agente é processo, não biblioteca

Um agente é um executável externo lançado num PTY. O app não importa SDK nem biblioteca de nenhum agente. Os agentes vivem num catálogo declarativo (dados), que define o executável, os argumentos, como passar o modelo, como passar o modo de permissão, como trocar o modelo em voo e como detectar a instalação. Acrescentar um agente é acrescentar uma entrada no catálogo; o motor não muda. Se um agente novo exigir mudança no motor, a mudança tem de ser genérica (uma nova capacidade declarável no catálogo) e não um caso especial por nome de agente.

### II. Trabalho na pasta do usuário, com controle explícito (INEGOCIÁVEL)

Sessões novas de agente rodam direto na pasta escolhida pelo usuário, seja ela um repositório git ou
não: o diretório de trabalho do processo é a própria pasta. Sessões antigas criadas num git worktree
continuam suportadas como legado até serem removidas, com as regras de remoção que já valiam (sem
diretório, registro em `git worktree list` nem branch órfã, exceto quando o usuário escolhe manter a
branch). O agente escreve na pasta porque o usuário o lançou ali; o app, por si, não.

- **O app não escreve por conta própria.** Escrita do app na pasta do usuário só acontece por ação
  explícita do usuário: salvar no editor ou uma operação de git confirmada. Nada de salvamento
  automático, formatação ao salvar, correção de fim de linha ou escrita em massa.
- **Editor (mantido da v1.2.0).** Só o salvar explícito grava; toda escrita registra caminho, tamanho
  e hash antes e depois no log estruturado; recusa gravar se o arquivo mudou em disco desde que foi
  aberto (conflito é reportado, nunca sobrescrito em silêncio); só dentro de uma raiz registrada e
  nunca em `.git/`.
- **Git na interface.** Stage, commit, push, pull, fetch, merge e troca de branch só por ação
  explícita do usuário. Operações que podem perder trabalho (descartar alterações, reset, force push,
  checkout com alterações pendentes, merge com conflito) exigem confirmação explícita que mostra o
  que será afetado. O app nunca guarda credenciais: delega ao git e ao gerenciador de credenciais do
  sistema.
- **Remover não apaga.** Remover sessão ou workspace nunca apaga a pasta do usuário nem os seus
  arquivos; sai só o registro do app (e, nas sessões legadas, o worktree do app).
- **Leitura sem efeito colateral.** Leituras de status usam comandos que não tocam o índice
  (`git --no-optional-locks`).

Razão: o agente precisa enxergar o projeto real e o histórico de conversas da pasta; o controle
continua com o usuário porque toda escrita do app e toda operação de git arriscada passam por uma
ação explícita dele.

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
- **Leitura autorizada (v1.2.0, 2026-10-21, autorizada pelo dono do projeto):** o repositório de referência pode ser clonado fora da pasta do projeto e lido para analisar o comportamento do produto — inventário de funcionalidades, modelo de domínio, fluxos de interação, decisões de plataforma e limites conhecidos. Continua proibido copiar, transcrever ou parafrasear código, nomes de símbolos ou estrutura de arquivos; toda conclusão entra em spec, plan ou documento de análise como descrição de comportamento, e cada decisão técnica segue justificada por documentação pública das bibliotecas usadas.
- **Higiene do clone:** o clone não entra no repositório do projeto (fica no `.gitignore`) e é apagado quando a análise termina. Enquanto existir, nenhuma alteração nele é commitada.

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

**Version**: 2.0.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-10-22
