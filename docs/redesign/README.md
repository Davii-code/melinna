# Melinna — Prism Workspace

Branch: `redesign/prism-workspace`. Implementação incremental sobre Electron, React, xterm.js e CodeMirror existentes. Nenhuma dependência adicionada; nenhum commit/push realizado.

## O que mudou

- Superfícies escuras em camadas, painéis arredondados, bordas discretas e acentos azul/violeta, guiados pelas duas referências de `desing/`.
- Avatar e prisma originais preservados. A Home usa a arte original em alta resolução, sem a animação pixelada anterior. Nenhuma imagem atrás de código, terminais ou diffs.
- Barra superior, navegação com rótulos, sessões com ações que cabem na sidebar, explorador, abas, botões, campos, menus, modais e estados de foco compartilham os tokens existentes evoluídos.
- Editor com abas persistentes em memória, indicador de rascunho, breadcrumbs relativos à raiz, botão de expansão, status de cursor/seleção, tema legível, scrollbar discreta e ações de gutter acessíveis por teclado.
- Fechar uma aba pelo teclado agora segue a mesma confirmação de alterações não salvas que o botão de fechar.

## Layout e continuidade

O seletor na barra superior oferece Automático, Terminais, Desenvolvimento, Destaque, Lateral e Personalizado. Os modos anteriores permanecem disponíveis.

**Desenvolvimento:** terminais acima e editores abaixo, com proporção inicial 50/50 e divisor redimensionável por ponteiro ou teclado. Dois terminais ficam lado a lado; mais terminais usam a grade existente na região superior. O editor ocupa toda a largura inferior e conserva suas divisões à direita/abaixo. Quando não há terminais, a região de edição ocupa a área disponível.

**Terminais:** preserva os editores montados e os oculta. Abrir um arquivo a partir de Terminais/Automático entra em Desenvolvimento quando há execuções. Layouts personalizados, Destaque e Lateral só mudam por escolha explícita.

**Editor em Foco:** botão Expandir/Restaurar ou `Ctrl+Shift+F11` (`Cmd` no macOS), registrado nos quatro mapas de atalhos. Amplia todos os editores divididos e restaura o foco anterior se o painel ainda existir. É transitório: reiniciar restaura o modo persistente anterior.

O novo módulo de geometria em `src/core/layout/regions.ts` reutiliza `CustomGrid`. `LayoutState.regions` acrescenta proporção e grades independentes de terminais/editores, sem sobrescrever a grade personalizada legada. Os mesmos canais IPC `layout:get/set` validam/persistem os campos opcionais; estados antigos continuam legíveis. A abertura não força mais layouts salvos para Automático.

A grade renderiza uma única coleção com chaves estáveis. Home, foco e modos não desmontam terminais/editores. Cada aba de execução tem sua instância de xterm; abas inativas continuam recebendo saída. A visibilidade real controla refit e envio de dimensões, mantendo debounce e limites de resize. Abas de arquivo visitadas conservam EditorView, cursores, scroll e histórico durante a sessão.

Uma correção de persistência evita reagendar gravações quando a lista de execuções não mudou. Falhas ao salvar layout agora aparecem na interface e não bloqueiam tentativas seguintes.

## Preservação funcional

| Área | Preservada pela implementação |
| --- | --- |
| PTY/agentes | Motor, processos, isolamento, lançamento, comandos e permissão existentes |
| Sessões | Reanexação, saída, histórico, scrollback e confirmação de bytes |
| Workspaces | Múltiplas pastas, raízes e disponibilidade |
| Layout | Modos anteriores, grade personalizada, redimensionamento e reorganização |
| Editor | CodeMirror, múltiplos cursores, busca/substituição, undo/redo, extensões, documentos compartilhados e salvar com hash |
| Git | Branches, seleção de mudanças, commits, diffs, conflitos, rede e confirmações |
| Ferramentas | Configurações de execução, catálogo, prompts, filas e envio de imagens |
| Interação | Mapas de atalhos e contextos, foco visível, erros, avisos e confirmações |

As referências contêm exemplos de funções e dados que não existem no produto. Não foram adicionados controles fictícios, agentes simulados à interface de produção ou formulários sem comportamento. Capturas usam exclusivamente fixtures de teste.

## Como executar e verificar

`npm.cmd run dev` abre o app de desenvolvimento neste Windows. Em outros shells, `npm run dev`.

1. Lance dois agentes e abra um arquivo por `Ctrl+P`: o editor deve aparecer abaixo dos terminais.
2. Arraste os divisores; use Tab e setas para redimensionar pelo teclado.
3. Edite sem salvar; use `Ctrl+Shift+F11` duas vezes. Confira texto, cursores e terminais.
4. Abra a Home e volte. Divida o editor pelo menu da aba.
5. Escolha Personalizado e abra outro arquivo: o modo deve continuar Personalizado.
6. Salve explicitamente, feche/reabra e confira modo, proporções, arquivos e sessões.

Inventário em [files.md](files.md). Validação detalhada e limitações em [validation.md](validation.md). Comparação visual em [comparison.html](comparison.html); screenshots em [screenshots](screenshots/). Avaliação visual em [design-qa.md](../../design-qa.md).

## Limites e decisões

- Editor em Foco é apresentação temporária; não encerra agentes nem grava arquivos.
- Rascunhos não salvos permanecem em memória durante a sessão. Não foi introduzido autosave nem recuperação de rascunhos após encerrar o processo.
- Alterar a quantidade de painéis de uma região recalcula sua distribuição; redimensionamentos persistem enquanto a composição permanece igual. A grade personalizada anterior é independente.
- Em pouco espaço, as regiões rolam em vez de reduzir o editor abaixo de 240 px ou os terminais abaixo do mínimo de leitura. Em janelas estreitas, a barra superior quebra em linhas e o botão redundante Focar editor é ocultado; Expandir e o atalho permanecem disponíveis.
- Não foram alterados protocolos de PTY, operações Git ou serviços de agentes. A única alteração em ExecutionService é uma anotação de tipos necessária para desbloquear o typecheck anterior.
