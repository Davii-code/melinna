# Feature 010 — Ambiente de desenvolvimento integrado

**Status:** implementação autorizada em 13/11/2026. O dono autorizou todo o escopo da análise de referência e delegou as decisões de implementação. Esta autorização permite prosseguir das especificações à implementação na mesma sessão. Referência de comportamento: `docs/analise-referencia-openidea.md`.

## Objetivo e mapa de capacidades

Unir edição de código, agentes e ferramentas em um ambiente com navegação familiar de IDE, preservando a marca Melinna, a pasta/worktree de cada sessão e o salvamento explícito.

| ID                | Responsabilidade                                     | Dependência                     |
| ----------------- | ---------------------------------------------------- | ------------------------------- |
| ide-shell         | Editor central, ferramentas e persistência de layout | layout atual                    |
| document-sync     | Detectar alterações externas e preservar rascunhos   | arquivos atuais                 |
| language-services | Diagnósticos, completion, navegação e refatoração    | document-sync, protocol-process |
| protocol-process  | Processos locais e mensagens estruturadas limitadas  | portas de processo              |
| debugger          | Sessões DAP e ferramentas de depuração               | protocol-process, run atual     |
| http-client       | Requisições explícitas, resposta e cancelamento      | integração desktop              |
| database-client   | Consultas SQLite locais e resultados                 | integração desktop              |

Ordem: fundação → sincronização → linguagens → ferramentas → shell integrado. Implementação independente; nenhum código ou asset externo será copiado.

## US1 — Trabalhar em código e agentes (P1)

O usuário abre as ferramentas sem perder os documentos ou processos já abertos. A área central mantém abas e divisões atuais; a área de ferramentas contém Problemas, Linguagem, Depuração, HTTP e Banco. Layout e seleção são restaurados. Cores, fontes e faixas de agentes permanecem as do Melinna.

Aceite: abrir/fechar ferramenta por teclado e botão; redimensionar painel com teclado e ponteiro; manter foco, documentos e processos; restaurar seleção/tamanho ao reabrir o app. Empty/error states compreensíveis e nomes acessíveis.

## US2 — Conviver com edições de agentes (P1)

Ao recuperar foco, o app compara arquivos abertos com o disco. Documento sem edições locais atualiza; documento sujo preserva texto e informa conflito, com comparação e recarga explícita. Salvamento continua protegido por hash e nunca vira autosave.

Aceite: alteração externa, remoção e arquivo inacessível não descartam rascunho; o mesmo documento em splits continua compartilhado; digitação durante leitura assíncrona não desaparece; listeners são removidos no fechamento.

## US3 — Entender e navegar pelo código (P1)

O usuário configura executable/argv de um servidor de linguagem por pasta e linguagem, iniciando explicitamente o processo. Suporte inicial a JS/TS e Java por servidores externos compatíveis com LSP. O app sincroniza rascunhos, apresenta diagnósticos, sugestões, hover, definição, referências e símbolos, e permite renomeação e ações de código quando o servidor oferece a capacidade.

Aceite: chamadas seguem a versão atual do rascunho; respostas atrasadas não substituem contexto novo; erros e indisponibilidade do servidor ficam visíveis; raízes/worktrees isolados; nenhuma instalação ou download automático de servidores. Alterações semânticas são apresentadas para confirmação e aplicadas aos rascunhos, sem salvar arquivos automaticamente. Caminhos fora das raízes, operações de arquivo não suportadas e versões conflitantes são recusados.

## US4 — Depurar execução (P2)

O usuário configura executable/argv de um adaptador DAP e argumentos JSON de launch/attach. Pode inserir/remover breakpoints, iniciar/encerrar sessão, continuar, pausar, avançar, examinar threads, pilha, escopos e variáveis. Uma sessão de debug possui diretório explícito e não utiliza o PTY de um agente como transporte de protocolo.

Aceite: initialize/configurationDone e breakpoints seguem o ciclo do adaptador; falhas, saída do processo e timeout encerram pedidos pendentes; breakpoints e configuração permanecem disponíveis entre sessões; parar fecha o adaptador e seus processos conforme suporte; ações desabilitadas fora do estado válido.

## US5 — Executar requisições HTTP (P2)

O usuário informa URL, método, headers e body, envia explicitamente e consulta status, headers, duração e corpo da resposta. Pode cancelar e usa timeout/tamanho limite. Apenas HTTP/HTTPS. Histórico mantém metadados não sensíveis em memória, sem persistir corpos, tokens ou headers de autenticação.

Aceite: erro de rede/timeout/cancelamento é distinguível; resposta binária é identificada; corpo excedente é truncado com aviso; nenhum request no mount ou seleção de histórico.

## US6 — Consultar banco local (P2)

O usuário escolhe arquivo SQLite dentro do workspace e abre uma conexão local somente leitura. Visualiza schema e executa consultas explicitamente com limite de linhas e tamanho de retorno. Escritas SQL ficam fora desta entrega. O app nunca guarda credenciais; SQLite não exige credenciais.

Aceite: conexão é liberada ao fechar; banco inválido e consulta inválida têm mensagens claras; resultado inclui colunas/linhas/truncamento; arquivo fora da raiz ou `.git` é recusado; leitura não cria banco inexistente. ReadOnly e authorizer do engine recusam escrita, ATTACH e extensões.

## Requisitos transversais

- FR01 Preservar os fluxos atuais de editor, terminal, Git, prompt e execução.
- FR02 Processos sempre com executable resolvido e argv, sem shell; `.cmd/.bat` não são executados diretamente com entrada de usuário.
- FR03 Core independente de Electron/React/Node; I/O de protocolo por portas injetadas.
- FR04 IPC apenas pelo frontend confiável, com validação de formas, comprimentos, IDs, raízes e permissões.
- FR05 Nenhuma escrita no projeto por iniciativa do app. Edits LSP alteram rascunhos após confirmação; salvar continua explícito. SQL permanece somente leitura.
- FR06 Limitar mensagens, resultados, tempo e número de sessões/pedidos. Fechar app rejeita pedidos e libera recursos.
- FR07 Não registrar texto de código, SQL, mensagens de protocolo, headers, credenciais nem corpos HTTP nos logs.
- FR08 Testes unitários/contrato/integração e componentes são escritos por comportamento; execução só a pedido do dono.

## Limites de entrega

Compatibilidade inicial de banco: SQLite. Servidores LSP e adaptadores DAP são executáveis externos configuráveis, não serviços instalados silenciosamente. Não inclui engine IntelliJ, indexador Java próprio, refatorações específicas de Fluig, marketplace, bancos remotos, remote SSH/mobile ou SDK de agentes. HTTP e SQLite fazem parte da entrega; bancos remotos podem ser acrescentados depois sem mudar a definição desta entrega.

## Sucesso

Cada história tem uma ferramenta utilizável pela interface, entrada validada e testes escritos, sem stubs. Um servidor LSP/adaptador ausente deve resultar em instruções claras de configuração. A implementação não exige nova dependência npm: usa CodeMirror existente e APIs nativas do runtime Electron/Node.
