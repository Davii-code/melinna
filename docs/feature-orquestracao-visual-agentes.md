# Orquestração visual de agentes no Melinna

Data da análise: 27/10/2026. Status: proposta técnica e de produto, com validação documental e inspeção local. Este documento registra a proposta original. O código e a primeira rodada de testes foram acrescentados posteriormente; consulte [o estado da implementação](orchestration/README.md).

## 1. Parecer de viabilidade

**É tecnicamente viável permitir Claude → Codex, Codex → Claude e combinações do mesmo provedor.** O Melinna deve ser o executor e a autoridade sobre sessões, limites e arquivos. O modelo coordenador decide o que delegar por uma ferramenta estruturada; o aplicativo valida a solicitação, executa o trabalhador escolhido e devolve seu resultado.

A imagem enviada representa bem o primeiro produto: um coordenador no topo, trabalhadores abaixo e conexões que mostram a delegação. A estrutura define quem pode chamar quem; os agentes efetivamente iniciados aparecem na execução. Não é necessário iniciar todos os trabalhadores a cada mensagem.

A viabilidade foi estabelecida pelas interfaces oficiais e pelos comandos disponíveis localmente. **Não foi executado um teste com inferência Claude → Codex ou Codex → Claude**, nem validada autenticação, custo ou disponibilidade dos modelos na conta do usuário. Isso exige uma prova de conceito antes de prometer compatibilidade operacional.

Recomendação: construir primeiro uma árvore de um coordenador e trabalhadores, com modelos/provedores configuráveis, concorrência limitada e inspeção de sessões. Adiar grafos arbitrários, ciclos e delegação recursiva.

## 2. O que foi validado

| Questão | Evidência e conclusão | Limite da validação |
| --- | --- | --- |
| Claude pode ser automatizado? | CLI oferece execução não interativa e eventos JSON; Agent SDK oferece controle programático. [Documentação](https://code.claude.com/docs/en/headless), [SDK](https://code.claude.com/docs/en/agent-sdk/overview). | Fluxo completo de aprovação precisa de teste no adaptador escolhido. |
| Claude pode chamar uma ferramenta do Melinna? | Claude Code suporta servidores MCP locais. O aplicativo pode expor a delegação como ferramenta. [MCP](https://code.claude.com/docs/en/mcp). | Ferramenta Melinna ainda precisa ser implementada. |
| Codex pode receber tarefas programáticas? | App Server oferece sessões, turnos, eventos e aprovações; exec atende tarefas delimitadas. [App Server](https://learn.chatgpt.com/docs/app-server), [modo não interativo](https://learn.chatgpt.com/docs/non-interactive-mode). | Protocolo precisa ser fixado por versão e testado. |
| Codex pode chamar o Melinna? | Pode consumir ferramentas de servidores MCP configurados. [MCP no Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). | Configuração deve ser por sessão/perfil quando suportado, preservando configurações pessoais. |
| Podemos usar codex mcp-server? | Não como base nova: foi removido; a documentação orienta App Server para integrações existentes. [SDK](https://learn.chatgpt.com/docs/codex-sdk). | Tutoriais antigos que dependem desse comando não se aplicam. |
| Subagente nativo Claude pode selecionar Codex no campo model? | A documentação descreve aliases/IDs Claude e herança de modelo. Isso não constitui suporte a Codex como processo externo. [Subagentes](https://code.claude.com/docs/en/sub-agents). | Delegação entre provedores requer a ponte do Melinna. |

### Verificação local, sem chamadas aos modelos

Comandos executados: claude --version, claude --help, codex --version, codex --help, codex exec --help e codex app-server --help.

- Claude instalado: **2.1.302**. Há opções print, stream-json, input-format, mcp-config, model, resume, max-budget-usd e agentes personalizados.
- Codex instalado: **0.164.0**. Há exec com JSONL, esquema de saída, retomada e App Server com transporte stdio. O help local ainda marca App Server como experimental.
- O catálogo do repositório registra verifiedWith **2.1.305** para Claude e **0.163.0** para Codex. Esses valores não correspondem exatamente aos binários locais; não equivalem a um teste desta feature.
- Não foram lidos tokens, arquivos de autenticação ou configurações sensíveis. Não foram iniciadas tarefas pagas, alteradas configurações globais nem instaladas dependências.

## 3. Base existente e lacunas

| Área | Arquivos relevantes | Reuso e trabalho necessário |
| --- | --- | --- |
| Catálogo | src/core/catalog/schema.ts, catalog/agents.json | Já separa executável, argumentos, modelo, permissões, prompt e resume. Acrescentar capacidades de orquestração verificadas por adaptador, sem inferir suporte a partir de kind=agent. |
| Execuções | src/core/execution/execution-service.ts, prepare.ts, start.ts | Já lança múltiplos agentes. launch envia task.prompt aos escolhidos; delegação precisa de enunciados específicos por trabalho, não de reenviar o mesmo prompt para todos. |
| Isolamento | src/core/execution/prepare.ts, src/core/git | Já prepara worktree e branch por execução, além do modo direto. Reusar a preparação e o controle de leases. |
| Persistência | src/core/persistence/state-schema.ts, src/core/execution/recovery.ts | Estado atual versão 4 tem tarefas/execuções, mas não equipe, ancestralidade, trabalho delegado ou resultado estruturado. |
| Processos | src/host/pty-supervisor.ts, server.ts, src/core/contracts/host-protocol.ts | Host atual é de PTYs. Integrações JSON/JSON-RPC exigem supervisão de processos com pipes, não leitura de ANSI do PTY. |
| Atividade | src/core/execution/busy-tracker.ts | Busy indica saída nos últimos 1,5 segundos. Nunca usar silêncio ou idle como conclusão de tarefa. |
| Prompts | src/core/prompts/prompt-sender.ts | Biblioteca e variáveis são reaproveitáveis. Sender atual digita no PTY; não substitui API estruturada de turnos. |
| Interface | src/core/layout/panes.ts, src/renderer/components/Grid/Grid.tsx, Panel, TerminalView | Reusar grade, terminais, foco e modos de desenvolvimento. A sessão não deve depender de o painel estar aberto. |

## 4. Experiência proposta

### Montar a equipe

Entrada próxima à criação de prompts/tarefas: opção **Equipe de agentes**, mantendo o fluxo de agente único.

Na tela de configuração:

- Centro: árvore com coordenador no topo e cartões de trabalhadores abaixo, inspirada na imagem. Acentos do prisma indicam identidade; estados também usam texto e ícone.
- Ao selecionar um cartão: provedor, modelo disponível, papel, instruções, capacidades, permissão e limite de instâncias.
- No coordenador: instruções para decompor, delegar, revisar e sintetizar; política de quando executar sozinho.
- Na equipe: workspace, isolamento, máximo de trabalhos paralelos, timeout e limites de uso.
- Ações: adicionar trabalhador, salvar modelo de equipe, validar disponibilidade e iniciar.
- Alternativa em lista totalmente navegável por teclado; arrastar cartões não é obrigatório.

Exemplo: coordenador Claude/Opus; pesquisadores Claude/modelo econômico; implementador Codex/modelo escolhido; revisor Claude ou Codex em somente leitura. Os nomes são exemplos de papéis, sem fixar um modelo como mais barato sem dados atualizados.

### Enviar um prompt

1. Usuário seleciona a equipe salva, escreve o objetivo e envia.
2. Preflight verifica binários, suporte do adaptador, autenticação utilizável, pasta, política e capacidade de criar worktrees quando necessário.
3. O coordenador recebe o objetivo e a ferramenta de delegação. O primeiro turno começa automaticamente.
4. Solicitações válidas entram na fila; os cartões mostram trabalhos reais, estado e resumo curto.
5. Trabalhadores devolvem resultados estruturados; o coordenador revisa, pode pedir correção e apresenta a síntese.
6. Resposta final distingue propostas, mudanças produzidas, alterações integradas e testes realmente executados.

Não executar um segundo classificador pago para toda mensagem se o próprio coordenador puder escolher entre responder e delegar. A montagem configura papéis permitidos; a execução mostra quantas instâncias foram criadas.

### Acompanhar sem encher a tela de terminais

A execução abre com conversa principal, árvore e atividade resumida. Cada cartão oferece **Abrir sessão**, **Ver resultado**, **Ver alterações** e, quando aplicável, **Parar trabalho**. Abrir/fechar inspeção não cria outro agente nem interrompe o existente.

**Distinção necessária:** processo headless/SDK não possui automaticamente uma TUI interativa à qual xterm possa se anexar. Para esses nós, mostrar um console de eventos/transcrição, claramente identificado. Terminal interativo real só aparece quando o adaptador consegue expor a mesma sessão com exclusão de escrita, ou para um shell auxiliar no worktree, identificado como outra sessão. Nunca lançar uma segunda CLI e apresentá-la como o trabalhador original.

O MVP deve garantir inspeção ao vivo de todos os trabalhadores. Se terminal interativo real de cada trabalhador for requisito indispensável, sua viabilidade é um gate da prova de conceito; console de eventos sozinho não satisfaz essa exigência.

## 5. Arquitetura recomendada

~~~mermaid
flowchart TD
  UI[React: prompt, árvore e sessões] --> IPC[IPC validado]
  IPC --> O[OrchestrationService]
  C[Coordenador Claude ou Codex] --> M[MCP Melinna: delegar e consultar]
  M --> O
  O --> Q[Agendador, políticas e orçamento]
  Q --> A[Adaptador Claude]
  Q --> B[Adaptador Codex]
  A --> CW[Processo Claude / SDK]
  B --> DX[Codex App Server]
  CW --> E[Eventos normalizados e resultados]
  DX --> E
  E --> J[Journal persistido]
  E --> UI
  O --> R[Resultado resumido ao coordenador]
  R --> C
~~~

**Coordenação é do modelo; execução e autorização são do Melinna.** O mesmo mecanismo atende as duas direções. A ferramenta recebe o ID do papel configurado, não uma linha de shell inventada pelo modelo.

### Ponte MCP do Melinna

Ferramentas propostas, ainda inexistentes:

- delegate_task: roleId, descrição delimitada, referências de contexto e chave de idempotência; devolve jobId.
- get_task: consulta estado e resumo de um trabalho autorizado.
- collect_results: busca resultados já disponíveis; não despeja logs completos no contexto.
- wait_tasks: espera limitada e cancelável, devolvendo pendências quando necessário.
- cancel_task: cancela somente descendentes permitidos pela política.

O servidor identifica runId e chamador por credencial de sessão, não por um campo livre fornecido pelo modelo. O agendador valida a relação permitida e reserva o slot de forma atômica.

delegate_task deve retornar rapidamente. Um coordenador pode criar vários trabalhos antes de aguardar, evitando serialização acidental. Callbacks de conclusão e retomada do coordenador precisam respeitar o mecanismo de turnos de cada provedor; não injetar bytes no meio de uma chamada de ferramenta. Ao encerrar um turno com pendências, o scheduler mantém a execução em espera e a retoma por API com os resultados persistidos. Esse fluxo precisa ser provado, inclusive quando a CLI termina antes do trabalho MCP.

Preferir um pequeno bridge stdio por sessão conectado a um serviço local autenticado do Melinna, sem endpoint público. Uma implementação HTTP em loopback também precisará autenticação e validação de origem; localhost sozinho não autoriza acesso. Configurações temporárias devem ter limpeza e escopo de sessão, sem sobrescrever arquivos pessoais.

### Adaptadores

Contrato conceitual: capabilities, start, sendTurn, events, interrupt, resume, stop e inspect. SessionId do provedor, runId, jobId e executionId são identidades distintas. Capabilities informa eventos estruturados, ferramentas externas, aprovações, retomada, métricas e terminal interativo real.

- **Claude:** avaliar primeiro CLI print/stream-json para prova simples. Para conversa bidirecional, aprovações e interrupção integradas, avaliar Agent SDK TypeScript e registrar custo/dependência da escolha. Não usar bare por padrão se o fluxo depende de skills/plugins existentes do usuário.
- **Codex:** preferir App Server para produto interativo; exec --json para trabalhos delimitados no spike. Gerar/fixar tipos contra a versão suportada. Dynamic tools são experimentais na documentação; MCP evita tornar esse campo requisito obrigatório. [Referência](https://learn.chatgpt.com/docs/app-server).
- **PTY atual:** continua para agentes e shells interativos existentes. Não precisa ser trocado.

Supervisor estruturado deve executar com executável e array de argumentos, pipes separados de stdout/stderr e sem shell interpolation. JSON fragmentado, saída inválida, backpressure, cancelamento da árvore de processos e diferenças Windows/Linux fazem parte do contrato.

## 6. Estado, falhas e recuperação

Entidades propostas:

| Entidade | Campos essenciais |
| --- | --- |
| TeamTemplate | id, schemaVersion, nome, coordenador, papéis, regras de delegação, políticas e limites |
| OrchestrationRun | id, templateSnapshot, taskId, objetivo, status, criadoEm, política e uso agregado |
| AgentSession | id, runId, roleId, provider, providerSessionId, executionId opcional, worktree e transport |
| DelegatedJob | id, runId, parentJobId, callerSessionId, workerSessionId, enunciado, baseCommit, tentativa, idempotencyKey e status |
| JobResult | jobId, resumo, artefatos, alterações, evidências de testes, uso disponível e motivo de término |
| RunEvent | eventId, runId, sequência, tipo, timestamp e payload validado |

Estados de trabalho: queued → starting → running → waiting_user/waiting_children → succeeded/failed/cancelled/interrupted. Estados de processo e de trabalho são independentes. Só evento final válido e validação do resultado permitem succeeded; exit code 0 sozinho não garante objetivo cumprido.

Persistir template em configuração versionada e snapshot imutável por execução; resultados/eventos em armazenamento local fora do código do usuário, com escrita atômica e política de retenção. Não salvar segredos no template.

MVP: ao fechar o app, impedir novos despachos e interromper de forma controlada sessões estruturadas, persistindo checkpoints; reabertura reconcilia e pede retomada quando necessária. O comportamento atual dos PTYs existentes é preservado. **Não prometer execução headless contínua após fechar o app** enquanto o novo supervisor não estiver em host durável.

Evolução: supervisor e scheduler em processo independente do renderer, com journal, heartbeat e reconexão. Retomada usa IDs explícitos; nunca resume --last ou continue por pasta compartilhada para identificar um trabalhador. Não há garantia de execução exatamente uma vez após crash: reconciliar antes de repetir efeitos, com idempotência de despacho e tentativas visíveis.

Pausar significa parar novos despachos; interromper um turno exige suporte do adaptador e não desfaz arquivos. Cancelar bloqueia novos descendentes antes de encerrar os existentes. Falha de um trabalhador permite continuação parcial ou parada conforme política. Retentativa é limitada e não duplica edição automaticamente.

## 7. Arquivos e integração Git

Trabalhadores de escrita devem usar worktrees isolados, derivados do mesmo commit base registrado. Revisor pode operar em leitura sobre o snapshot/patch recebido. Pastas extras não recebem escrita irrestrita só por pertencerem ao workspace.

O resultado entrega manifest de alterações e artefatos, não apenas texto “terminei”. Coordenador em outro worktree não enxerga automaticamente a edição do trabalhador: o Melinna precisa disponibilizar patch/artefatos e preparar uma área de integração controlada.

MVP: revisão de diff e aplicação pelo usuário, sem commit ou push automático. O materializador de patch deve ser uma operação determinística do produto, validando paths, binários, exclusões, links e conflitos; uma promessa do modelo de não commitar não é controle suficiente.

Após integração, executar validações sobre o resultado combinado. Se B depende da alteração de A, iniciar B sobre snapshot integrado ou aplicar o artefato explicitamente; não iniciar ambos na mesma base e presumir visibilidade. Em pasta sem Git, permitir leitura e análise; edição paralela fica desabilitada no MVP ou é serializada com indicação clara.

## 8. Economia e controle de uso

Delegar pode reduzir contexto do coordenador e direcionar tarefas simples a modelos menores, mas pode aumentar tokens totais, latência ou retrabalho. Não prometer percentual de economia antes de medir.

Defaults propostos para o piloto, configuráveis: uma camada de trabalhadores, até dois trabalhos ativos, até oito trabalhos totais, até uma retentativa por trabalho e timeout por tarefa. Trabalhadores não recebem a ferramenta de delegação na primeira versão.

Enviar objetivo, critérios de aceitação, paths/trechos necessários e restrições; não copiar todo histórico para cada trabalhador. Resultados retornam resumo curto e referências de evidência. Escalonar para modelo mais capaz quando houver falha explícita ou decisão do coordenador dentro da política.

Orçamento precisa reservar margem para trabalhos em voo. Limites locais são aproximados quando o provedor informa uso apenas após o turno; custo indisponível aparece como desconhecido. Tokens de provedores diferentes não representam custo equivalente. Exibir separadamente tokens reportados, cobrança reportada e estimativa, sem deduzir preço fixo do nome do modelo.

Autenticação não deve ser confundida com cobrança: a documentação Claude consultada distingue uso por assinatura e créditos API com organização vinculada. [Orientação oficial atual](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Para cada adaptador, validar o modo suportado na conta, sem extrair tokens de terceiros ou pressupor que uma assinatura autorize qualquer backend. Acesso aos modelos e limites continuam sujeitos ao provedor.

## 9. Permissões e limites de confiança

Melinna autoriza ferramentas, workspace e descendentes por sessão. Não herdar bypass global para conseguir executar em background. Aprovações pendentes aparecem no cartão e na conversa, com contexto e decisão registrada.

A árvore desenhada expressa autorização de delegação, mas não é sandbox de sistema operacional: se um agente tem shell arbitrário e rede, pode iniciar outra CLI por fora. Limites fortes de custo/filhos exigem também restrições reais de ferramentas, processo, rede e credenciais. O produto deve indicar quando observa apenas delegações gerenciadas.

Conteúdo de arquivos e respostas de trabalhadores é dado não confiável; não pode ampliar permissões. Rejeitar papel desconhecido, referência a outra execução, ciclo, excesso de filhos e pedido fora do workspace. Redigir logs sensíveis; não registrar prompts/segredos indiscriminadamente. Modelo escolher o escopo de sua própria autorização não é permitido.

## 10. Compatibilidade com o Claude Kit

O usuário descreveu um conjunto de comandos, mas seus arquivos não foram fornecidos nem inspecionados nesta análise. Não é possível garantir importação automática sem conhecer formato, licença, hooks e dependências.

Caminho proposto: importar instruções de comandos/skills como rascunho de papéis; mostrar preview do conteúdo e pedir ao usuário escolher mapeamento. Separar instruções úteis de comandos específicos do runtime Claude. Preservar arquivos originais e referências à origem.

Subagentes internos de um Claude Kit permanecem internos ao processo Claude, salvo eventos identificáveis fornecidos pelo adaptador. Não desenhar um terminal independente fictício para cada um. Para visibilidade homogênea e mistura de provedores, recomendar trabalhadores gerenciados pelo Melinna; integração profunda de subagentes nativos fica para etapa posterior.

## 11. Implementação por etapas

### Etapa 0 — prova de conceito, antes do construtor visual

Criar fixture descartável e registrar versões. Implementar ponte mínima e dois adaptadores de teste: Claude coordenador delega análise somente leitura ao Codex; repetir invertendo os papéis. Usar critérios objetivos, resultado com identificador e verificar que o coordenador realmente o consumiu.

Validar eventos, duas delegações paralelas, erro de autenticação, timeout, aprovação, cancelamento, fechamento e retomada. Medir uso reportado e overhead. Registrar diferenças entre CLI simples e adaptador interativo. A execução com inferência será um teste explícito com contas configuradas, não consequência de abrir o documento.

Gate: nenhuma dependência de ANSI/idle, resultado correlacionado à solicitação, ausência de processos órfãos e honestidade sobre console versus terminal real. Se algum adaptador não permitir a interação necessária, restringir a combinação na UI.

### Etapa 1 — núcleo e equipe mínima

Criar src/core/orchestration com scheduler, políticas, eventos e persistência; portas puras em core e adaptadores concretos na camada de infraestrutura. Criar ponte MCP local e IPC próprio para templates/runs/eventos, sem alterar contratos de terminal existentes.

Uma equipe, coordenador e papéis; papéis de trabalhadores sem recursão; leitura por padrão; snapshot de configuração por execução. Executar atrás de feature flag. Não registrar contas/provedores como habilitados sem preflight.

### Etapa 2 — tela visual e inspeção

Adicionar componentes de configuração, árvore e atividade no renderer. SVG/CSS para árvore simples evita biblioteca pesada; considerar biblioteca de grafos somente quando pan/zoom e edição de grafos justificarem dependência.

Adicionar console estruturado como tipo de painel próprio, preservando editor, terminais, redimensionamento e foco. Estado da execução continua fora do React. Limitar renderização de logs e virtualizar históricos extensos quando necessário.

### Etapa 3 — escrita e Git

Worktrees por trabalhador, artefatos, revisão/aplicação, conflitos e validação combinada. Sem merge/commit/push automático no MVP. Aprovações e tentativas auditáveis.

### Etapa 4 — evolução

Templates reutilizáveis, importação assistida do Kit, métricas comparativas e host durável. Só depois avaliar dependências DAG, recursão limitada e colaboração entre níveis. “Outro agente” entra mediante adaptador e testes, não apenas cadastro de executável.

## 12. Critérios de aceitação e testes

- Salvar/reabrir equipe com modelos e papéis preservados; navegação por teclado e foco visível.
- Um envio inicia o coordenador; ele pode executar sozinho ou delegar a papéis autorizados.
- Claude → Codex e Codex → Claude provados em fixture com resultado retornado e usado.
- Pelo menos dois trabalhadores executam em paralelo respeitando fila e limite global.
- Abrir/fechar sessão e alternar layout preserva processo, eventos e resultado; console não é rotulado terminal interativo.
- Falha, negação de permissão e modelo indisponível ficam explícitos e não viram sucesso.
- Timeout/cancelamento impede novos filhos e não deixa processos órfãos, inclusive no Windows.
- Recuperação não repete edição/trabalho automaticamente após crash sem reconciliação.
- Dois escritores isolados produzem diffs revisáveis; conflito impede integração silenciosa.
- Sem regressão nos PTYs atuais, scrollback, sessões, CodeMirror, prompts, atalhos e Git.

Testes unitários: estados, limites, orçamento, identidade do chamador, idempotência, contexto e cancelamento. Integração: adaptadores com processos falsos, JSON fragmentado, stderr, perda de conexão e host recovery. E2E Electron: árvore, prompt, atividade e painel de inspeção usando agentes falsos. Smoke real por provedor é opt-in, separado da CI comum e com limites pequenos; não comparar economia usando só mocks.

Comparar tarefas equivalentes com agente único versus equipe: custo reportado/estimado separado, tokens, tempo, taxa de testes aprovados e retrabalho. A economia só fica demonstrada com qualidade semelhante e medições reais.

## 13. Entrega desta análise e decisões pendentes

A etapa original de análise adicionou somente este documento. A implementação e os testes posteriores estão descritos no [relatório de validação](orchestration/validation.md). A imagem foi usada como referência conceitual de hierarquia, sem copiar a foto pessoal para o repositório.

A primeira entrega recomendada é a prova de conceito bidirecional e uma equipe visual simples. Antes de expandir, confirmar na prática: autenticação de cada adaptador, tratamento de aprovação, retomada, terminal interativo versus console e comportamento ao fechar o app. Economia de tokens, integração automática do Kit e terminais reais dos subagentes nativos permanecem hipóteses a validar.
