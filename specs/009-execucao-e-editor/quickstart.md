# Quickstart: 009

Pré-requisitos: `npm install`, Git 2.30+, um workspace com um `package.json` (scripts `start` e `test`)
num repositório git.

## Validar

- `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`,
  `npm run test:perf`, `npm run test:e2e` (disparados pelo dono do projeto: `/testar`).
- App: `npm run dev`.

## Cenários

1. **Migração**: com um estado de esquema 3 que tem um comando personalizado, abrir o app → o comando
   aparece como configuração salva e continua ativo (SC-003; detalhes em [data-model.md](data-model.md#migração-3--4)).
2. **Configuração com ambiente**: seletor → "Adicionar a partir de um script detectado…" → `start` →
   "Editar configurações…" → `PORT=4000`, `Node options` `--max-old-space-size=4096` → Rodar → o terminal
   mostra o servidor na porta 4000.
3. **Antes de lançar**: configurar `test` como "antes de lançar" de `start`; com um teste quebrado,
   `start` não roda e a mensagem cita `test` e o código de saída.
4. **Várias instâncias**: ligar a opção e rodar duas vezes → dois terminais.
5. **Editor**: ir para linha `120:5`; estrutura do arquivo; próxima ocorrência três vezes; buscar no
   projeto; dividir à direita; ver a margem do git e reverter um trecho; salvar uma vez.

Contratos: [contracts/ipc.md](contracts/ipc.md), [contracts/ui.md](contracts/ui.md).
