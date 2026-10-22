# Research: Git na interface

## R1. Plugin do IntelliJ ou do VS Code

- **Decision**: não usar; interface própria sobre o git do sistema.
- **Rationale**: plugins do IntelliJ são Java/Kotlin e só rodam na plataforma da JetBrains; plugins do
  VS Code dependem da API dele. O app já chama o git com segurança.

## R2. Biblioteca de git ou git do sistema

- **Decision**: git do sistema via `GitRunner` (sem shell).
- **Rationale**: usa as credenciais e a configuração do usuário (GCM, SSH, hooks); sem dependência nova.
- **Alternatives considered**: isomorphic-git / nodegit (dependência nova, credenciais e hooks
  diferentes do que o usuário vê no terminal).

## R3. Credenciais sem travar

- **Decision**: `GIT_TERMINAL_PROMPT=0` em todas as operações de rede; `GCM_INTERACTIVE` não é
  definido (no Windows o Git Credential Manager pode abrir a janela própria, como o usuário espera);
  sem credencial → erro `GIT_AUTH` com orientação.
- **Rationale**: sem terminal, um prompt do git travaria a operação para sempre.

## R4. Pull

- **Decision**: `pull --no-rebase` (merge) por padrão.
- **Rationale**: não reescreve histórico; conflitos seguem o mesmo fluxo do merge da US3.

## R5. Mensagem de commit

- **Decision**: `git commit -F <arquivo temporário em os.tmpdir()>`, apagado depois; nunca dentro do
  repositório (Princípio II).
- **Rationale**: mensagens com várias linhas e caracteres especiais sem limite de linha de comando.

## R6. Progresso e cancelamento

- **Decision**: `--progress`, ler o stderr e extrair a porcentagem (`Receiving objects:  45%`);
  cancelar mata o processo do git (`AbortSignal`).

## R7. Decisões assumidas pelo plano

- `status --untracked-files=all`: lista arquivos dentro de pastas novas (agrupamento e commit corretos).
- Branch principal do remoto: `refs/remotes/<remote>/HEAD`; senão `main`; senão `master`.
- `GIT_LITERAL_PATHSPECS=1`: caminhos vindos da interface nunca são interpretados como pathspec mágico.
- Commit durante merge: sem lista de caminhos (o git recusa commit parcial em merge).
- Falha de commit: o app tira do índice só o que ele mesmo adicionou.
- Diff acima de 1 MB: mostrado como "grande demais"; binário marcado pelo `diff.ts` existente.
- Erro do git: a mensagem vem da linha `fatal:`/`error:`, não da última linha (avisos de CRLF).
