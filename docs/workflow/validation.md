# Validação — 27/10/2026

- Typecheck: passou nas três configurações TypeScript.
- Build Electron/Vite: passou.
- ESLint dos módulos novos e alterações diretamente relacionadas: passou. O contrato compartilhado conserva três erros anteriores de união com void; não foram alterados contratos antigos apenas para silenciar o lint.
- Testes de arquitetura: 8 passaram.
- Testes direcionados de domínio, filesystem, armazenamento e preload: 22 passaram.
- Testes direcionados de interface: 11 passaram (5 da revisão e 6 de criação de tarefa).
- Suíte E2E completa: 19 passaram, em cerca de 1,9 minuto. Usa Electron e PTYs reais com agentes simulados; não usa serviços pagos nem credenciais de modelos.
- Suíte global unitária/componentes: 1.858 testes, 1.831 passaram e 27 falharam. Essa execução precedeu a inclusão dos cinco novos testes de interface, executados separadamente. As falhas se concentram nas áreas previamente identificadas: caminhos Windows/ChangeTree, merge/CommitPanel, seleção de campos de configurações, ordenação Git, empacotamento Linux, MemoryFS, eventos busy/idle antigos, busca, migração/persistência, fila de prompts, configurações Maven/wrappers, workspace/layout e formatos de erros IPC. Nenhum teste novo de workflow falhou. A suíte global não está verde.

## Cenário E2E novo

Cria um repositório temporário com uma alteração local anterior ao agente; cria/aplica um perfil; confirma checkpoint anterior ao lançamento e preservação do objetivo; altera arquivos; inspeciona diff; executa verificação Node através da configuração salva; edita o resumo; inicia outra sessão nativa; bloqueia restauração enquanto há execução ativa; para a execução, mostra prévia e restaura preservando a edição anterior do usuário; confirma checkpoint de segurança; reabre o aplicativo e verifica persistência.

## Cobertura adicional

Testes de filesystem verificam conteúdo binário, múltiplas pastas, caminhos sobrepostos, junctions, conteúdo corrompido, alteração após prévia e preservação de arquivos ignorados. Testes do domínio verificam opt-out, perfis, notas, bloqueios, evidência desatualizada e avisos estimados. Testes da integração entre serviços verificam ordem de preparação/checkpoint/PTY, falha antes de spawn, execução na worktree de origem e cancelamento de etapas anteriores ao comando principal.

## Limitações da validação

Não foram utilizados Claude/Codex reais nem notificações nativas com inspeção visual do sistema operacional. Passagem direta foi exercitada de ponta a ponta; preparação de worktree isolada tem testes de serviço/filesystem, sem cenário E2E específico. A suíte de integração separada e os testes de performance não foram executados nesta etapa. A captura documenta a revisão; não constitui comparação antes/depois de toda a aplicação.
