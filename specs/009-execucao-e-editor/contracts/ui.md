# Contrato de interface: 009

## Configurações de execução

- `RunConfigsDialog` (substitui `RunConfigDialog`): `role="dialog"` com nome "Configurações de execução".
  - Barra da árvore: botões `Adicionar configuração`, `Remover configuração`, `Copiar configuração`,
    `Nova pasta`, `Ordenar`.
  - Árvore `role="tree"`, grupos por ferramenta (`npm`, `Maven`, `Gradle`, `Compose`, `Programa`) e pasta.
  - Formulário: `Nome`, `Pasta`, `Script` (ou `Objetivos`/`Tarefas`), `Programa`, `Argumentos`,
    `Opções do runtime` (rótulo por ferramenta: `Node options`, `MAVEN_OPTS`, `GRADLE_OPTS`),
    tabela `Variáveis de ambiente` (`Adicionar variável`, `Remover <nome>`, `Mostrar valor de <nome>`),
    `Antes de lançar`, `Permitir várias instâncias`.
  - Ações: `Rodar`, `OK`, `Cancelar`, `Aplicar`.
- `RunSelector`: só configurações salvas; itens `Editar configurações…` e
  `Adicionar a partir de um script detectado…`; vazio: `Nenhuma configuração`.

## Editor

Ações novas (`AppAction` e diálogo de atalhos), com tecla nos quatro mapas:

| Ação | windows | intellij | eclipse | vscode |
|---|---|---|---|---|
| `goToLine` | Ctrl+G | Ctrl+G | Ctrl+L | Ctrl+G |
| `goToSymbol` | Ctrl+F12 | Ctrl+F12 | Ctrl+O | Ctrl+Shift+O |
| `selectNextOccurrence` | Ctrl+D | Alt+J | Alt+J | Ctrl+D |
| `unselectLastOccurrence` | Ctrl+U | Shift+Alt+J | Shift+Alt+J | Ctrl+U |
| `findInProject` | Ctrl+Shift+F | Ctrl+Shift+F | Ctrl+H | Ctrl+Shift+F |
| `replaceInFile` | Ctrl+H | Ctrl+R | Ctrl+F | Ctrl+H |
| `toggleComment` | Ctrl+/ | Ctrl+/ | Ctrl+/ | Ctrl+/ |
| `reindent` | Ctrl+Alt+I | Ctrl+Alt+I | Ctrl+I | Ctrl+Alt+I |
| `reopenClosedTab` | Ctrl+Shift+T | Ctrl+Shift+T | Ctrl+Shift+T | Ctrl+Shift+T |
| `splitRight` | — (menu da aba) | — | — | Ctrl+\ |

Conflitos com atalhos já existentes do app ou do terminal são verificados no teste do mapa
(`keymaps.test.ts`); com o foco no terminal, as ações do editor não disparam.

- Popups: `Ir para linha` (campo `Linha[:coluna]`), `Estrutura do arquivo` (lista filtrável),
  `Buscar no projeto` (campo, opções `Maiúsculas`, `Palavra inteira`, `Expressão regular`,
  `Arquivos`, lista de resultados por arquivo e prévia).
- Menu da aba: `Fechar`, `Fechar outras`, `Fechar todas`, `Dividir à direita`, `Dividir abaixo`;
  `Reabrir aba fechada` no menu do painel.
- Margem do git: marcas com `aria-label` "Linhas adicionadas/alteradas/removidas"; popup com o original
  e `Reverter este trecho`.
