# Revisão, perfis e passagem de tarefas

Acesso pelo botão **Revisão** da barra superior ou pela ação de revisão de uma tarefa. Esta funcionalidade é manual: não recria a antiga equipe/orquestração e não chama modelos para gerar resumos.

## Uso

1. Em **Perfis de uso**, salve agente, modelo, permissão, instruções e preferência de checkpoint. O perfil pode ser global ou do workspace. Ao criar uma tarefa, escolha o perfil e escreva o objetivo normalmente. As instruções são anexadas ao lançamento sem substituir o objetivo registrado.
2. Por padrão, um checkpoint é criado antes de iniciar um agente. Na aba **Revisão**, escolha a execução e compare os arquivos com esse ponto inicial; alterações locais anteriores ficam preservadas como base. Também é possível criar checkpoints manuais e revisar diffs unificados ou divididos.
3. Registre objetivo, decisões, pendências e restrições. Execute uma configuração de execução já salva para validar o trabalho. A revisão registra comando/configuração, status, código de saída e impressão dos arquivos; indica quando o resultado ficou desatualizado após novas alterações. A saída continua no terminal nativo.
4. Em **Passar para outro agente**, gere um resumo, revise/edite o texto e escolha o agente de destino. A confirmação interrompe a execução de origem, cria um checkpoint e abre outra sessão PTY com o texto aprovado. O histórico interno do modelo não é transferido. Em worktree isolada, os arquivos da raiz principal são preparados na nova worktree; pastas extras mantêm seu vínculo existente.
5. Para restaurar, pare todas as execuções que compartilham as pastas envolvidas. Confira a prévia de arquivos e confirme. Um checkpoint de segurança é salvo antes da restauração e pode ser usado para desfazê-la. Uma alteração posterior à prévia invalida a operação.
6. Em **Avisos**, consulte término/falha de processos e resultados de verificações. Avisos do sistema são opcionais quando a janela está em segundo plano. O aviso por ausência de saída é opcional, desativado inicialmente e explicitamente uma estimativa, sem confirmar conclusão da tarefa.

## Arquitetura e preservação

- Domínio: src/core/workflow; adaptadores de armazenamento e arquivos: src/adapters; API tipada e IPC: src/shared/workflow-api.ts e src/main/ipc/register-workflow.ts; interface: src/renderer/components/Workflow.
- Integração com os serviços existentes de execução e configurações de comandos. Sem substituir PTY, xterm, CodeMirror, layout, Git ou persistência de sessões. O lançamento admite preparação de arquivos e um hook antes do agente iniciar; comandos de verificação usam a infraestrutura existente.
- Estado em userData/workflow/state.json e conteúdo deduplicado por SHA-256 em userData/workflow/blobs. Checkpoints não criam commits nem modificam o index do Git. Não há chamada paga adicional para resumo, perfil ou checkpoint.
- Armazenamento inválido é preservado e sinalizado; não é silenciosamente sobrescrito. É possível desabilitar checkpoint e lançar sem perfil enquanto o problema é resolvido.

## Escopo e limites

- Snapshot de arquivos rastreados e não ignorados pelo Git, incluindo modificações locais anteriores. Fora do Git, usa exclusões de dependências, builds e caches. Arquivos ignorados, como um .env ignorado, ficam fora da captura e restauração.
- Limites por captura: 20 mil arquivos, 100 MB totais e 25 MB por arquivo; exceder falha explicitamente. Repositórios internos são enumerados separadamente, respeitando suas regras de ignore e preservando os metadados Git. Links simbólicos/junctions não são percorridos. Pastas extras indisponíveis são sinalizadas como revisão parcial. A restauração exige as pastas do checkpoint disponíveis.
- Checkpoint automático ocorre antes de lançar/reiniciar agentes; não intercepta cada mensagem ou edição feita pelo processo. Agentes já abertos antes desta funcionalidade não ganham uma base retrospectiva inventada.
- Processos externos continuam podendo alterar arquivos: há validação de fingerprint, verificação por arquivo e rollback condicionado às alterações realizadas pela própria restauração. Não é um snapshot transacional do sistema operacional.
- Código de saída zero confirma somente o comando, não a qualidade da tarefa. Nenhuma interpretação automática de resultados ou histórico interno é apresentada como evidência.
- Não há retenção automática/limpeza de checkpoints nesta versão. O usuário deve considerar espaço em disco e o conteúdo dos arquivos não ignorados capturados localmente.

## Executar e validar

Use npm.cmd run dev. Crie um perfil, abra uma tarefa em um repositório de teste, altere um arquivo e abra Revisão. Teste uma configuração de comando curta, gere/edite a passagem para outro agente e restaure um checkpoint após parar as execuções.

Veja [resultados de validação](validation.md).
