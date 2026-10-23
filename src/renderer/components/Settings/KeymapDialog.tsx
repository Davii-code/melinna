import { useEffect } from 'react';
import { KEYMAP_IDS } from '../../../shared/ipc-contract';
import { useKeymap, type KeymapStore } from '../../keymap/keymap-store';
import { ACTIONS, ACTION_LABEL, KEYMAPS, KEYMAP_LABEL, formatChord, isMac } from '../../keymap/keymaps';

export interface KeymapDialogProps {
  store: KeymapStore;
  onClose: () => void;
}

/** "Mapa de atalhos": escolhe entre Windows, IntelliJ, Eclipse e VS Code; a troca vale na hora e fica guardada. */
export function KeymapDialog({ store, onClose }: KeymapDialogProps) {
  const current = useKeymap(store);
  const mac = isMac();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal keymap-dialog" role="dialog" aria-modal="true" aria-label="Mapa de atalhos">
        <h2>Mapa de atalhos</h2>
        <p className="hint">
          Escolha o conjunto de teclas que você já conhece. Ctrl+C, Ctrl+D, Ctrl+Z, Ctrl+B e as setas ficam
          sempre com o terminal.
        </p>
        <div className="keymap-options">
          {KEYMAP_IDS.map((id) => (
            <section key={id} className={`keymap-option${id === current ? ' current' : ''}`}>
              <label className="check">
                <input
                  type="radio"
                  name="keymap"
                  value={id}
                  checked={id === current}
                  onChange={() => void store.set(id)}
                />
                {KEYMAP_LABEL[id]}
              </label>
              <table aria-label={`Atalhos do mapa ${KEYMAP_LABEL[id]}`}>
                <thead>
                  <tr>
                    <th scope="col">Ação</th>
                    <th scope="col">Tecla</th>
                  </tr>
                </thead>
                <tbody>
                  {ACTIONS.map((action) => {
                    const chord = KEYMAPS[id][action];
                    return (
                      <tr key={action}>
                        <td>{ACTION_LABEL[action]}</td>
                        <td>{chord === null ? '—' : <kbd>{formatChord(chord, mac)}</kbd>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
