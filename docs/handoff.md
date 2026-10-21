# Handoff — 2026-10-21 09:53
## Objetivo
Melinna Desk: app desktop (Electron) que roda agentes de CLI em PTYs paralelos, um git worktree por execução. Feature `specs/001-workspace-agentes-paralelos` (modo Spec Kit), branch `001-finalizar-us3-us6`.

## Feito
- Tasks 165/165 marcadas (última: T165); commit `b030a14` com US3–US6 + Polish.
- Depois do commit (NÃO commitado): workspaces (pasta vira grupo com cor), enunciado opcional, tela inicial (avatar, saudação, barra rápida, "Novo terminal", "Abrir workspace", recentes), botão "Início", ícone com avatar + selo do prisma (`npm run icons`).
- Instalador gerado: `dist/Melinna-Setup-0.1.0.exe` (ícone novo; app abre e loga `app.ready`).
- `tsc --noEmit` passa em tsconfig.node, tsconfig.web e tsconfig.web-test.

## Pendente (próxima task primeiro)
1. Rodar `/testar` (unit, integração, arch, lint): nenhuma suíte foi executada nesta sessão.
2. Commitar as mudanças pós-`b030a14` na branch `001-finalizar-us3-us6`.
3. Push da branch e PR para `main`.
4. Assistente de configuração na primeira abertura (detectar/ligar agentes) — pedido, ainda não feito.

## Decisões tomadas (e o porquê, 1 linha cada)
- Workspace = `Group` com `repoPath/repoId/colorIndex/lastOpenedAt` opcionais: evita entidade nova e migração de estado.
- "Novo terminal" usa worktree isolado: mantém o Princípio II da constitution.
- Enunciado opcional (0–100.000): pedido do usuário; dois testes antigos que exigiam enunciado foram atualizados.
- `toSideBySide` em `src/shared/`: renderer não pode importar `src/core/git` (teste de arquitetura).
- `git branch -D` na remoção: a perda de trabalho já é checada contra a base, `-d` compararia com o HEAD do repo.
- `npmRebuild: false`: node-pty 1.1 é N-API com prebuilds; recompilar exigiria Python.
- Ícones renderizados por software e com `window-all-closed` vazio: a captura por GPU falhava e o app fechava antes de gravar.

## Arquivos-chave (caminho — papel)
- src/renderer/components/Home/Home.tsx — tela inicial e lançamento rápido
- src/core/workspace/workspace-service.ts — `openWorkspace`, enunciado opcional
- src/core/execution/{lifecycle,switch-service,switch-planner}.ts — parar/relançar/remover e troca de modelo/modo
- src/renderer/App.tsx — composição da UI (árvore, grade, home, diálogos)
- scripts/render-icons.mjs + electron-builder.yml — ícone e instalador
- specs/001-workspace-agentes-paralelos/spec.md — seção "Atualização de 2026-10-21"

## Problemas abertos / riscos
- Pasta não rastreada `software-clone/alethe-agents` no projeto: parece o repo de referência AGPL; não ler nem commitar (Princípio IX). Confirmar com o usuário se apaga ou vai para o `.gitignore`.
- O npm 11 bloqueia scripts de instalação: após `npm install`, rodar `node node_modules/electron/install.js`.
- Instalador não assinado (aviso do SmartScreen).

## Próximo passo exato
/testar
