# Ferramentas IDE do Melinna

A área inferior reúne Código e problemas, Depuração, HTTP e Banco de dados. Os editores, terminais e agentes existentes continuam na área central. O painel pode ser recolhido sem encerrar ferramentas ou perder campos preenchidos.

## Navegação e layout

- Clique em uma aba de ferramenta para abri-la. `Ctrl+Alt+I` recolhe/expande o painel.
- Arraste a divisória superior para redimensionar. Com foco na divisória, use as setas para cima/baixo.
- As setas esquerda/direita, Home e End navegam pelas abas de ferramentas.
- Seleção e altura são restauradas no próximo uso. Processos e requisições não reiniciam automaticamente.
- A aparência usa tokens, fontes e cores do Melinna. Código ou assets do projeto usado na análise não foram incorporados.

## Alterações externas e salvamento

Ao recuperar o foco, os documentos abertos são comparados com o disco. Um documento sem edições locais pode ser atualizado. Quando há um rascunho ou um arquivo deixou de ser legível, o texto local permanece e aparece um aviso.

Use **Comparar com o disco** para consultar a versão externa. **Recarregar do disco** exige confirmação para descartar alterações locais; nova digitação durante a leitura impede a substituição. **Manter rascunho** fecha o aviso, mas não remove a proteção de conflito ao salvar.

Arquivos binários ou truncados não substituem o rascunho. Salvar continua explícito e protegido pelo hash original. Os mesmos documentos em splits compartilham o rascunho; alterações programáticas atualizam o CodeMirror montado.

## Linguagens

Na aba Código e problemas, informe:

1. A pasta/worktree a que o servidor terá acesso.
2. Um executável instalado na máquina.
3. Os argumentos como uma lista JSON de strings.
4. Clique em **Iniciar servidor LSP**.

O transporte é LSP 3.17/JSON-RPC por stdin/stdout, com `Content-Length` em bytes UTF-8. O servidor precisa negociar posições UTF-16. O app suporta sincronização full e incremental, documentos versionados, completion, hover, definição, referências, símbolos, rename e ações de código baseadas em alterações de texto. Capacidades ausentes são reportadas pelo servidor e pelo app; instalar realce de sintaxe não fornece essas capacidades.

Para JS/TS, configure um servidor compatível, como [typescript-language-server](https://github.com/typescript-language-server/typescript-language-server). Para Java, configure [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls), incluindo JVM, argumentos e diretórios de configuração exigidos pela instalação. O Melinna não instala nem baixa esses programas. No Windows, informe Node/Java/Python nativo e o script/jar nos argumentos em vez de executar um wrapper `.cmd`/`.bat`.

Exemplo de formato de argumentos, ajustado ao programa instalado:

```json
["/caminho/real/da/instalacao/servidor.js", "--stdio"]
```

O caminho acima é ilustrativo, não um arquivo fornecido pelo app. Consulte o ponto de entrada da sua instalação. O executável e os breakpoints são lembrados por pasta; argumentos do servidor, payload de debug, código e segredos não são persistidos pelo painel.

No editor:

- `Ctrl+Espaço`: sugestões semânticas. Use setas e Enter/Tab ou clique para escolher; Escape fecha.
- Hover: documentação enviada pelo servidor, apresentada como texto.
- `F12`: definição. `Shift+F12`: referências.
- A ferramenta oferece também símbolos do arquivo/projeto, rename e ações de código.
- Diagnósticos aparecem no painel e são marcados no texto. Clique em um problema para navegar.

Escolher uma completion simples modifica somente o rascunho. Rename e alterações adicionais apresentam prévia; **Aplicar aos rascunhos** revalida todos os documentos antes de aplicar o conjunto. Se um texto ou arquivo mudou, nenhuma parte do conjunto é aplicada. Novos rascunhos são abertos para arquivos antes fechados. Gravar exige salvar explicitamente no editor.

Comandos arbitrários vindos do servidor e operações de criar/remover/mover arquivos não são executados. Ações de código que dependem exclusivamente desses comandos ficam indisponíveis. Java/Fluig não recebe regras específicas de Fluig automaticamente.

## Depuração

Informe um adaptador DAP instalado que use stdin/stdout, seu executável e argumentos; clique em **Iniciar adaptador DAP**. Depois forneça um objeto JSON de `launch` ou `attach` de acordo com a documentação desse adaptador e use **Iniciar depuração** ou **Anexar depuração**.

O payload depende do adaptador. O Melinna não transforma um servidor DAP TCP em stdio nem instala adaptadores. Adaptadores que exigem `runInTerminal` do cliente não são suportados nesta entrega; configure o console interno do adaptador quando disponível. A pasta do payload é conferida contra a raiz escolhida.

- Clique na margem de breakpoints do editor ou em **Alternar breakpoint na linha do cursor**.
- Ao suspender, escolha a thread e o frame para consultar escopos e variáveis.
- Use Continuar, Pausar, Próxima linha, Entrar e Sair.
- Frames e variáveis antigos são descartados quando a execução continua. Caminhos de bibliotecas externas podem aparecer sem navegação de fonte, enquanto arquivos da pasta autorizada podem ser abertos.
- **Parar depuração** desconecta e encerra o adaptador. Encerrar a ferramenta fecha seus processos auxiliares.

Em **Configurações de execução do Melinna**, carregue e execute uma configuração já existente. A configuração usa o RunStore atual e suas confirmações. Configure a porta de debug do programa nessa configuração e use attach com o adaptador correspondente. O app não acrescenta flags de debug silenciosamente.

O JSON launch/attach não é persistido. Breakpoints são versionados e limitados por raiz; não se misturam entre worktrees. Eles são posições de linha: confira-os após alterações estruturais no arquivo e salve a versão que será executada antes de depurar.

## HTTP

Informe método, URL, headers JSON e corpo. Nada é enviado antes de clicar em **Enviar requisição**. Há cancelamento e timeout de 30 segundos.

- Apenas HTTP/HTTPS, sem credenciais embutidas na URL.
- Corpo de entrada até 1 MiB; retorno até 2 MiB; truncamento é informado.
- Até cinco redirecionamentos na mesma origem. Para outra origem, abra a URL de destino explicitamente.
- Respostas são exibidas como texto, nunca executadas como HTML. Binários são identificados.
- Histórico em memória contém apenas método, origem sem query/userinfo, status e duração. Headers, tokens e corpos não são persistidos nem registrados em logs.

O cliente nativo não compartilha cookies ou sessão com o navegador embutido. Certificados e resolução de rede seguem o runtime; falhas de TLS não são contornadas pelo app.

## SQLite

Informe o caminho de um banco SQLite existente dentro de uma pasta aberta e clique em **Abrir somente leitura**. O schema inicial vem de `sqlite_schema`. Digite uma consulta e clique em **Executar consulta**.

O engine abre com `readOnly`, proteção defensiva e extensões desabilitadas. O authorizer recusa escrita, ATTACH, DETACH, PRAGMA e funções de carregamento de extensão/arquivos. A conexão não cria um banco inexistente. Bancos remotos e SQL de escrita não fazem parte desta entrega.

Consultas rodam em worker separado, com até 500 linhas, 2 MiB de resultado e 10 segundos. Uma consulta excedida encerra a conexão; abra-a novamente se necessário. Valores inteiros de 64 bits são apresentados como texto para preservar precisão, e binários como descrição de tamanho. Fechar conexão libera o worker.

## Limites e confiança

Servidores LSP e adaptadores DAP são processos locais escolhidos explicitamente pelo usuário. Não são uma sandbox do sistema operacional: execute somente ferramentas em que confia, como faria ao instalar uma extensão de IDE. O IPC e a navegação do Melinna continuam limitados às raízes registradas, com `realpath` e recusa de `.git`.

Há até quatro sessões auxiliares de protocolo, quatro requisições HTTP e quatro conexões SQLite. Mensagens têm limite de 8 MiB e até 128 pedidos pendentes por sessão; pedidos de protocolo expiram em 20 segundos. Fontes, SQL e payloads não entram nos logs de operação.

## Estado da validação

Feature: `specs/010-editor-ide/`. Código e testes foram escritos; build, typecheck, testes, lint e navegador não foram executados nesta implementação, conforme o fluxo solicitado. Os roteiros de aceite estão em `specs/010-editor-ide/quickstart.md`. A execução desses checks pelo dono ainda é necessária antes de tratar a entrega como validada para distribuição.
