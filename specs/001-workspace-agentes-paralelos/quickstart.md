# Quickstart: Workspace de agentes paralelos

## Pré-requisitos (Windows)

- Node 24 e npm (mesma linha do Node embutido no Electron 44)
- Git 2.30+ no PATH
- Visual Studio Build Tools com "Desenvolvimento para desktop com C++" e Python 3 (para recompilar o node-pty)
- Opcional: `claude`, `codex`, `gemini` instalados e autenticados

## Comandos

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npm run test:perf
```

```bash
npm run test:e2e
```

## Validação manual da fatia

1. Abrir o app, criar um grupo, nova tarefa num repositório de teste, marcar dois agentes e lançar.
2. Conversar nos dois painéis; abrir o diff de cada um.
3. Fechar o app escolhendo "Manter rodando"; reabrir e verificar histórico e reanexação.
4. Remover as execuções e conferir `git worktree list` e `git branch` no repositório de teste.
5. Conferir que `git status` do repositório de teste está igual ao início.
6. SC-008: com 12 execuções do agente falso vivas, somar a memória de trabalho do processo principal, dos renderers e do hospedeiro no Gerenciador de Tarefas; deve ficar em até 800 MB.
7. SC-002 (pintura): digitar com 6 painéis ativos e confirmar ausência de atraso perceptível; o trecho principal ↔ hospedeiro é medido por `npm run test:perf`.

## Agente falso para testes

`tests/fixtures/fake-agent.mjs` com a entrada `fake` em `tests/fixtures/catalog.fake.json`; copiar para `<userData>/catalog.json` para usá-lo no app.
