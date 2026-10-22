# Quickstart: validar imagens no terminal

## Automático

```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Roteiro manual (para o /testar-tela, no app)

1. **Print de tela** — Win+Shift+S (Windows) ou a captura do sistema (Linux); clicar no painel de um
   Claude Code e apertar Ctrl+V. Esperado: prévia com a miniatura; "Enviar" escreve o caminho no
   prompt sem Enter; o agente descreve a imagem após Enter.
2. **Cancelar** — repetir e apertar Esc. Esperado: nada escrito no terminal.
3. **Texto** — copiar um texto e Ctrl+V. Esperado: colado como antes, sem prévia.
4. **Arrastar** — soltar um PNG e um PDF do explorador no painel. Esperado: prévia só com o PNG e o PDF
   listado como recusado.
5. **Anexar** — botão de clipe na linha da execução; escolher duas imagens. Esperado: as duas vão
   juntas ao enviar, separadas por espaço; caminho com espaço vai entre aspas.
6. **Sem suporte** — colar imagem no painel de um PowerShell/Bash. Esperado: aviso "Este agente não
   recebe imagens"; nada escrito.
7. **Limite** — soltar uma imagem de mais de 20 MB. Esperado: recusada com a mensagem do limite.
8. **Limpeza** — colar duas imagens, parar e remover a sessão. Esperado: a pasta
   `attachments/<execId>` some dos dados do app; o PNG arrastado no passo 4 continua no lugar.
