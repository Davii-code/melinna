# Quickstart: validar configurações de execução e mapas de atalhos

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:arch
npm run test:e2e
```

## Roteiro manual (para o /testar-tela, no app)

Prepare workspaces com os projetos de `tests/fixtures/projects/` (`node-app`, `maven-app`,
`compose-app`, `broken`).

0. **Sem ativa** — primeiro uso. Esperado: seletor "Nenhuma configuração ativa", ▶ desabilitado com
   "Escolha uma configuração"; ⋮ com "Rodar de novo"/"Parar" desabilitados.
1. **Seletor** — abrir o seletor na barra superior. Esperado: grupos por workspace e pasta; `node-app`
   com "dev" e "test" (npm); Maven com compilar/testar/empacotar (no Windows, aviso de wrapper
   ignorado); `broken` com aviso de `package.json` inválido; sem `docker`, compose desabilitado com
   "não encontrado: docker".
2. **Rodar** — escolher "dev", clicar ▶. Esperado: painel com "servidor de exemplo no ar"; seletor
   indica rodando; ▶ de novo foca o mesmo painel.
3. **Menu** — ⋮ → "Rodar de novo": separador "relançado em" no mesmo painel; ⋮ → "Parar": painel
   mostra o código de saída.
4. **Editar configurações** — ⋮ → "Editar configurações" → nova: nome "oi", programa `node`,
   argumentos `-e` e `console.log("oi mundo")`, pasta do workspace. Rodar. Esperado: `oi mundo`.
   Nome repetido → "Já existe uma configuração com esse nome". Detectada: campos só leitura e
   "Duplicar".
5. **Lembrar** — fechar e reabrir o app. Esperado: mesma configuração ativa; personalizada continua.
6. **Excluir rodando** — excluir a personalizada enquanto roda. Esperado: "Pare o comando antes."
7. **Vagas** — com 12 terminais vivos, Rodar. Esperado: mensagem de limite.
8. **Mapa de atalhos** — abrir "Mapa de atalhos", escolher IntelliJ; com o terminal em foco,
   Ctrl+Shift+N abre "ir para arquivo" e Shift+F10 roda a configuração ativa; Ctrl+P não faz nada do
   app. Voltar a Windows: Ctrl+P abre "ir para arquivo". Ctrl+C no terminal continua interrompendo.
9. **Mapa persiste** — com IntelliJ escolhido, fechar e reabrir o app. Esperado: IntelliJ continua.
10. **Pasta fora** — remover do workspace a pasta de uma personalizada. Esperado: desabilitada com
    "pasta fora do workspace".
11. **Dicas** — com o mapa IntelliJ, o título de "Salvar"/"Rodar" mostra a tecla do mapa.
