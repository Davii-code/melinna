# Quickstart: validar rodar o projeto e abrir na IDE

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Roteiro manual (para o /testar-tela, no app)

Prepare três pastas: um projeto Node com scripts `dev` e `test` e `package-lock.json`; um projeto
Maven com `mvnw`; um projeto com `compose.yaml`.

1. **Detectar** — "▶" do workspace Node. Esperado: `npm run dev`, `npm run test`.
2. **Rodar** — `dev`. Esperado: painel com a saída; linha na árvore com "Parar" e "Rodar de novo".
3. **Rodar de novo / parar** — Esperado: separador "relançado em" no painel; parar encerra.
4. **Maven** — workspace Maven. Esperado: compilar/testar/empacotar; no Windows, aviso de wrapper
   ignorado e uso do `mvn`; no Linux, `./mvnw`.
5. **Ausente** — sem `docker` instalado, workspace com `compose.yaml`. Esperado: itens desabilitados
   com "não encontrado: docker".
6. **Personalizado** — "Novo comando…": programa `node`, argumentos `-e` e `console.log("oi mundo")`.
   Esperado: saída `oi mundo` (argumento com espaço preservado).
7. **Vagas** — com 12 terminais vivos, rodar um comando. Esperado: mensagem de limite.
8. **VS Code** — "Abrir em… → VS Code" no workspace; no editor, cursor na linha 42, abrir no VS Code.
   Esperado: abre a pasta; depois o arquivo na linha 42.
9. **IntelliJ ausente** — "Abrir em… → IntelliJ" sem IntelliJ. Esperado: mensagem com onde procurou;
   informar o caminho; abrir de novo funciona e o caminho fica guardado.
10. **Explorador** — "Mostrar no explorador". Esperado: gerenciador de arquivos na pasta.
