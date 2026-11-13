# Configuração e validação futura

1. Abrir um workspace no Melinna e manter um arquivo em dois splits; editar em um e conferir ambos.
2. Alterar o arquivo externamente. Ao recuperar foco, draft limpo atualiza; draft sujo permanece disponível para comparar/recarregar. Salvar continua explícito e protegido por hash.
3. Configurar executável/argv de servidor LSP com stdio para JS/TS ou Java, iniciar e abrir documento compatível. Verificar completion, hover, definições, referências, símbolos e diagnósticos. Confirmar alterações semânticas e conferir que continuam não salvas.
4. Configurar um adaptador DAP com launch/attach JSON. Adicionar breakpoint e iniciar. Conferir pilha, escopos, variáveis e step; parar e verificar término da sessão.
5. Em HTTP, enviar requisição explicitamente, cancelar uma requisição lenta e testar resposta acima do limite.
6. Escolher SQLite dentro da raiz. Consultar schema e tabela. Tentar escrita, ATTACH e extensão: conferir recusa pelo engine. Não existe modo de escrita.
7. Reabrir o app e conferir preferências de layout. Servidores, debug e requests não iniciam automaticamente.

Comandos para o dono disparar quando desejar: `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:arch`, `npm run build`. Nenhum foi executado nesta implementação sem solicitação.
