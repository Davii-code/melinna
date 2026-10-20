<div align="center">

<img src="docs/brand/logo-wordmark.svg" alt="melinna" width="480" />

<br />
<br />

**Um feixe entra. Seis saem.**<br />
Workspace desktop local-first para rodar vários agentes de código de CLI em paralelo,
cada um num terminal PTY vivo e isolado no seu próprio git worktree.

<br />

<img src="docs/brand/avatar.jpg" alt="Melinna" width="290" />

<br />
<br />

![status](https://img.shields.io/badge/status-especifica%C3%A7%C3%A3o-4f8cff?style=flat-square&labelColor=07080b)
![plataforma](https://img.shields.io/badge/Windows-primeiro-34c759?style=flat-square&labelColor=07080b)
![stack](https://img.shields.io/badge/Electron%20%C2%B7%20node--pty%20%C2%B7%20xterm.js-bf5af2?style=flat-square&labelColor=07080b)

</div>

---

## O que é

Você escreve uma tarefa, escolhe quais agentes devem tentar, e o Melinna cria uma branch e um git worktree isolado para cada um antes de lançá-los ao mesmo tempo. Cada execução é um terminal real e interativo, não um log morto: você conversa com cada agente no seu painel, compara o que cada um produziu e escolhe qual aproveitar.

A árvore de trabalho principal do seu repositório nunca é escrita nem tem a branch trocada.

## Funcionalidades da primeira versão

| | Funcionalidade | |
|:-:|---|---|
| 🟥 | **Terminal PTY vivo por execução** | prompts interativos, cores e redesenho de tela funcionam; a conversa continua sem relançar |
| 🟧 | **Scrollback persistido e reanexação** | feche e reabra o app: os agentes continuam rodando e os painéis voltam com o histórico |
| 🟨 | **Isolamento por worktree** | uma branch e um worktree por execução, fora do seu repositório, removíveis sem deixar resíduo |
| 🟩 | **Grade de painéis** | modos Automático, Spotlight, Sidebar e Grade personalizada, com arrastar e soltar |
| 🟦 | **Modelo e permissão por painel** | troca em voo quando o agente suporta; aviso claro quando não suporta |
| 🟪 | **Comparação de diffs** | lado a lado ou unificado, por execução |

Agentes iniciais: Claude Code, Codex CLI e Gemini CLI, mais os shells do sistema. Os agentes vivem num catálogo declarativo: acrescentar um agente é acrescentar uma entrada, sem mexer no motor.

## Princípios

- **Agente é processo, não biblioteca.** O app lança executáveis num PTY; nenhum SDK de agente é importado.
- **Isolamento por worktree.** Todo trabalho acontece numa branch e num worktree próprios.
- **O PTY é a fonte da verdade.** O processo do agente sobrevive à interface; fechar o app não perde o scrollback.
- **Núcleo independente da camada de desktop.** A orquestração não importa o framework de desktop, e um teste reprova quem tentar.
- **Sem shell no lançamento.** Argumentos vindos do catálogo e do texto do usuário nunca passam por `cmd.exe` ou `sh -c`.
- **Código e marca próprios.** Ideias de produto podem ter inspiração externa; código, nome, logo e assets são exclusivamente deste projeto.

A lista completa está na [constitution](.specify/memory/constitution.md).

## Status

O projeto está na fase de especificação, feita com o [GitHub Spec Kit](https://github.com/github/spec-kit). Nenhum código de produção ainda.

| Artefato | Caminho |
|---|---|
| Constitution | [`.specify/memory/constitution.md`](.specify/memory/constitution.md) |
| Spec da primeira fatia | [`specs/001-workspace-agentes-paralelos/spec.md`](specs/001-workspace-agentes-paralelos/spec.md) |
| Plano técnico | [`specs/001-workspace-agentes-paralelos/plan.md`](specs/001-workspace-agentes-paralelos/plan.md) |
| Contratos | [`specs/001-workspace-agentes-paralelos/contracts/`](specs/001-workspace-agentes-paralelos/contracts/) |
| Tasks (165) | [`specs/001-workspace-agentes-paralelos/tasks.md`](specs/001-workspace-agentes-paralelos/tasks.md) |

## Stack planejada

Electron 44 · node-pty 1.1 (ConPTY no Windows) · @xterm/xterm 6 · React 19 · TypeScript estrito · Vitest · Playwright

Pré-requisitos e comandos de desenvolvimento estão no [quickstart](specs/001-workspace-agentes-paralelos/quickstart.md).

## Identidade visual

<img src="docs/brand/logo.svg" alt="" width="56" align="left" />

Um feixe de luz branco entra num prisma e sai decomposto em seis faixas coloridas: uma tarefa atacada por vários agentes em paralelo. Tema escuro como primário, sobre `#07080b`, com acento `#4f8cff`.

<br clear="left" />

![#ff3b30](https://img.shields.io/badge/-%23ff3b30-ff3b30?style=flat-square)
![#ff9f0a](https://img.shields.io/badge/-%23ff9f0a-ff9f0a?style=flat-square)
![#ffd60a](https://img.shields.io/badge/-%23ffd60a-ffd60a?style=flat-square)
![#34c759](https://img.shields.io/badge/-%2334c759-34c759?style=flat-square)
![#0a84ff](https://img.shields.io/badge/-%230a84ff-0a84ff?style=flat-square)
![#bf5af2](https://img.shields.io/badge/-%23bf5af2-bf5af2?style=flat-square)

Assets em [`docs/brand/`](docs/brand/).

## Autor

Feito por [@Davii-code](https://github.com/Davii-code).
