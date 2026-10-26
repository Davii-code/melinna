import { useEffect, useRef, useState } from 'react';
import { GOTO_LINE_HELP, parseLineSpec, type LineSpec } from './extensions/goto-line';

export interface GotoLinePopupProps {
  /** Linhas do arquivo, para a dica do campo. */
  lineCount: number;
  onGo: (spec: LineSpec) => void;
  /** Fecha o popup; quem abriu devolve o foco ao editor. */
  onClose: () => void;
}

/** Popup "Ir para linha": um campo `Linha[:coluna]`; Enter vai, Esc fecha. */
export function GotoLinePopup({ lineCount, onGo, onClose }: GotoLinePopupProps) {
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const submit = () => {
    const spec = parseLineSpec(text);
    if (spec === null) {
      setInvalid(true);
      return;
    }
    onGo(spec);
    onClose();
  };

  return (
    <div className="modal-backdrop editor-popup-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal editor-popup"
        role="dialog"
        aria-modal="true"
        aria-label="Ir para linha"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label>
            Linha[:coluna]
            <input
              ref={input}
              type="text"
              inputMode="numeric"
              placeholder={`1–${lineCount}`}
              value={text}
              aria-invalid={invalid}
              onChange={(e) => {
                setText(e.target.value);
                setInvalid(false);
              }}
            />
          </label>
          {invalid && (
            <p role="alert" className="field-error">
              {GOTO_LINE_HELP}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
