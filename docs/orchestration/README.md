# Equipes de agentes — implementação

Implementação em desenvolvimento na branch feature/visual-agent-orchestration.

**Validação executada em 27/10/2026.** Typecheck, build, testes específicos, arquitetura, E2E e smokes reais Claude ↔ Codex passaram. As suítes globais ainda têm falhas antigas/intermitentes: consulte [resultados e limitações](validation.md).

## Entrada no aplicativo

A barra superior recebe o botão **Equipes**, quando a API de orquestração está disponível. A tela permite:

1. Configurar um coordenador Claude ou Codex e de um a doze papéis de trabalhadores.
2. Selecionar modelo, instruções e acesso de cada papel; o coordenador fica em leitura.
3. Definir concorrência, total de trabalhos, timeout por sessão, turnos do coordenador e limite aproximado de tokens reportados.
4. Salvar a equipe e selecionar o workspace.
5. Enviar um objetivo para iniciar a coordenação e abrir as sessões pelo cartão do trabalho.

O botão de verificar CLIs executa somente a consulta de versão quando acionado pelo usuário. Isso não confirma autenticação ou disponibilidade do modelo. Iniciar uma equipe cria processos de agentes e pode consumir limites/cobrança das contas configuradas.

## Código adicionado

- src/core/orchestration: tipos de domínio, validação, portas e OrchestrationService.
- src/adapters/orchestration-runtime.ts: processos estruturados para Claude print/stream-json e Codex exec/JSONL, Git e integração de patches.
- src/adapters/orchestration-store.ts: arquivo JSON versionado com substituição por arquivo temporário.
- src/main/orchestration/mcp-bridge.ts: servidor MCP HTTP em loopback, com credencial efêmera por execução.
- src/main/ipc/register-orchestration.ts e src/shared/orchestration-api.ts: API tipada e handlers.
- src/renderer/components/Orchestration: biblioteca de equipes, árvore de papéis/trabalhos, conversa, configurações, console, confirmações e revisão de patch.

Integrações pontuais em main, preload, contrato IPC, App, diálogo de fechamento e escopo de atalhos. Sem dependências novas e sem substituição do host PTY, CodeMirror ou xterm.

## Funcionamento

O coordenador recebe ferramentas MCP delegate_task, get_task, collect_results, wait_tasks e cancel_task. O chamador é associado à execução pela credencial da ponte, sem aceitar runId arbitrário nos argumentos da ferramenta. Trabalhadores não recebem essa ponte; a delegação gerenciada tem uma camada.

A fila reserva slots antes de iniciar trabalhos. Chaves de idempotência evitam que a mesma solicitação seja despachada novamente. Novas tentativas são explícitas e criam outro trabalho/worktree. Há somente uma equipe ativa por vez nesta versão.

O modelo escolhe quais papéis usar. Eventos JSON e eventos finais identificam progresso e conclusão do turno; silêncio do terminal não determina conclusão. Resultados são devolvidos ao coordenador em turnos subsequentes, com retomada por ID quando reportado pelo provedor. O resultado do modelo não é uma prova automática de que o objetivo ou os testes foram cumpridos.

O botão **Pausar fila** impede novos despachos; trabalhos já iniciados podem continuar. Cancelamento interrompe o coordenador e os trabalhos pendentes, preservando arquivos produzidos. Falhas do coordenador cancelam os trabalhos ainda pendentes.

## Sessões e terminais

A tela mostra **console de eventos**, com acompanhamento ao vivo e resultado final. Não é uma TUI interativa, não injeta teclas em uma sessão headless e não abre um segundo agente fingindo ser o primeiro.

Os terminais tradicionais da IDE permanecem disponíveis ao voltar à IDE. Anexação de terminal interativo real à mesma sessão programática ainda exige outro adaptador e validação específica. O adaptador Codex desta implementação usa exec, não App Server; aprovações interativas e controle fino de turnos são evoluções do adaptador, não capacidades já entregues.

## Git e arquivos

O início da execução registra o commit base. Trabalhadores Git usam worktrees/branches isolados derivados desse commit, inclusive papéis de leitura. Alterações locais não commitadas não são copiadas. A raiz Git precisa ser a pasta selecionada no workspace.

Pastas sem Git permitem equipes exclusivamente de leitura. Escrita exige Git com pelo menos um commit. O coordenador não aplica alterações por ferramenta: o usuário revisa o patch e confirma a aplicação na tela.

A geração do patch usa índice temporário próprio, incluindo arquivos novos não ignorados, sem modificar o índice real. Novos links simbólicos são recusados. A primeira integração exige workspace limpo; aplicações posteriores da mesma equipe verificam uma impressão digital das alterações para evitar sobrepor edições externas. Conflitos são recusados pelo git apply. Não há commit, merge ou push automático.

Depois da aplicação, os arquivos continuam modificados para revisão e commit pelo fluxo Git existente. Worktrees, branches e histórico são preservados; não há limpeza destrutiva automática. Também não há transferência automática de alterações de um trabalhador ao worktree de outro: dependências de implementação devem ser tratadas em execução posterior ou com integração explícita.

## Persistência e fechamento

Arquivo: diretório de dados do Electron/orchestration/state.json. Worktrees: mesmo diretório/orchestration/worktrees. Nenhuma alteração de configuração MCP global é feita pelo produto.

Templates são copiados para cada execução; editar uma equipe salva não muda o histórico. Estados são persistidos nas transições e o histórico recente de eventos recebe checkpoints periódicos. A memória do console é limitada por sessão; não é um arquivo integral e ilimitado de stdout.

Fechar o aplicativo interrompe as sessões estruturadas, mesmo escolhendo manter os PTYs tradicionais em segundo plano. Reabertura conserva a execução como interrompida, com retomada explícita e repetição explícita dos trabalhos. Não há supervisor headless durável independente do Electron nesta versão. Crash pode perder a cauda mais recente dos eventos e exige reconciliação; não há garantia de execução exatamente uma vez.

Se o armazenamento estiver inválido, a feature expõe um aviso e impede novas operações de escrita, preservando o arquivo original em vez de substituí-lo por um histórico vazio. As demais funções do aplicativo continuam sendo inicializadas.

## Políticas e limites

- Claude: ferramentas de leitura; Edit/Write para papéis de escrita; Bash e subagentes nativos não fazem parte da lista exposta. Permissões não atendidas geram falha, sem abrir confirmação nativa no console.
- Codex: sandbox read-only/workspace-write e aprovação never. Não utiliza bypass de sandbox. Configuração pessoal é ignorada no exec, mantendo a autenticação do CLI.
- Essas políticas não representam um sandbox universal entre provedores. Hooks, regras gerenciadas e particularidades da versão precisam ser auditados na validação.
- A credencial MCP fica apenas no processo principal/ambiente dos filhos e é redigida nos eventos. Não entra no histórico persistido nem em argumentos de linha de comando com seu valor real.
- Limite de tokens é aproximado: não pode impedir consumo ocorrido antes de o provedor reportar uso. Custo agregado é parcial quando um provedor não informa valor monetário.
- Versões de CLI incompatíveis, autenticação ausente e opções rejeitadas devem aparecer como falha. Os caminhos de leitura foram validados com Claude Code 2.1.302 e Codex CLI 0.164.0; outras versões e modos ainda precisam de teste.
- Importação do Claude Kit aceita texto Markdown/TXT para instruções, com prévia. Não importa nem executa automaticamente hooks, comandos ou uma configuração inteira de terceiros.

## Validação

Consulte o [relatório completo](validation.md), que registra comandos, correções, testes aprovados, comparação com o baseline e falhas remanescentes. As chamadas aos modelos reais são opt-in; a suíte comum usa agentes simulados.

[Captura da interface no Electron](screenshots/visual-team.png).
