import { Annotation, Transaction, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Marca as transações copiadas de outro editor do mesmo arquivo: não voltam a ser copiadas. */
const fromSibling = Annotation.define<boolean>();

const viewsByPath = new Map<string, Set<EditorView>>();

function key(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Registra o editor do arquivo; enquanto há outro do mesmo arquivo (editor dividido), as edições se espelham. */
export function registerSharedView(path: string, view: EditorView): () => void {
  const k = key(path);
  const set = viewsByPath.get(k) ?? new Set<EditorView>();
  set.add(view);
  viewsByPath.set(k, set);
  return () => {
    set.delete(view);
    if (set.size === 0) viewsByPath.delete(k);
  };
}

/** Quantos editores mostram o arquivo agora. */
export function sharedViewCount(path: string): number {
  return viewsByPath.get(key(path))?.size ?? 0;
}

/**
 * Espelha cada edição deste editor nos outros editores do mesmo arquivo, como transações anotadas (sem
 * entrar no desfazer de quem recebe). Cada lado mantém a própria rolagem, cursor e histórico.
 */
export function sharedDoc(path: string): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const siblings = viewsByPath.get(key(path));
    if (siblings === undefined || siblings.size < 2) return;
    const own = update.transactions.filter((tr) => tr.docChanged && tr.annotation(fromSibling) !== true);
    if (own.length === 0) return;
    const annotations = [fromSibling.of(true), Transaction.addToHistory.of(false)];
    for (const other of siblings) {
      if (other === update.view) continue;
      if (!other.state.doc.eq(update.startState.doc)) {
        // O outro lado estava diferente (aberto de um texto antigo): passa a ter o texto inteiro deste.
        other.dispatch({
          changes: { from: 0, to: other.state.doc.length, insert: update.state.doc },
          annotations,
        });
        continue;
      }
      for (const tr of own) other.dispatch({ changes: tr.changes, annotations });
    }
  });
}
