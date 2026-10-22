# Research: Orquestrador de prompts (primeira fatia)

## R1. Onde guardar biblioteca e fila

- **Decision**: arquivo próprio `userData/prompts.json` (versão 1), gravação atômica.
- **Rationale**: desacopla do esquema do `state.json` (que a feature 003 migra para v3); um arquivo
  corrompido de prompts não derruba o estado do app.
- **Alternatives considered**: dentro do `state.json` (acopla migrações); arquivo no repositório
  (compartilhável, mas escreve no projeto — fica para depois, com aprovação).

## R2. Como enviar o texto

- **Decision**: reaproveitar `promptBytes` de `src/core/execution/prompt-delivery.ts` (texto + Enter;
  com várias linhas, colagem entre marcadores `ESC[200~ … ESC[201~` + Enter).
- **Rationale**: já é como o enunciado inicial chega aos agentes, testado na feature 001.

## R3. Quando a sessão está ociosa

- **Decision**: usar a transição para ocioso do `BusyTracker` (já usada para o status "ocioso").
  O item é marcado como enviado antes de escrever, para nunca enviar duas vezes.
- **Alternatives considered**: detectar o prompt do agente na saída (frágil, varia por agente).

## R4. Fila ao fechar o app

- **Decision**: persistir a fila; ao abrir, descartar filas de execuções que não existem mais e
  retomar as demais na próxima ociosidade.
- **Rationale**: o hospedeiro mantém as sessões vivas com o app fechado; a fila deve acompanhar.
