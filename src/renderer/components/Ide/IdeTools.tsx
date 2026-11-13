import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { FileRoot } from '../../../shared/ipc-contract';
import type { EditorSession } from '../Editor/editor-session';
import { LanguageTools } from './LanguageTools';
import { DebugTools } from './DebugTools';
import { HttpTools } from './HttpTools';
import { DatabaseTools } from './DatabaseTools';
import { readToolLayout, writeToolLayout, type ToolTab } from './tool-layout';
import type { Position } from './workspace-edits';

const tabs: { id: ToolTab; label: string }[] = [
  { id: 'language', label: 'Código e problemas' },
  { id: 'debug', label: 'Depuração' },
  { id: 'http', label: 'HTTP' },
  { id: 'database', label: 'Banco de dados' },
];
export function IdeTools({
  roots,
  editor,
  onOpen,
  onRun,
}: {
  roots: readonly FileRoot[];
  editor: EditorSession;
  onOpen(path: string, position?: Position): void;
  onRun(groupId: string, configId: string): void;
}) {
  const [layout, setLayout] = useState(() => readToolLayout(localStorage));
  const drag = useRef<{ y: number; height: number } | null>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => writeToolLayout(localStorage, layout), [layout]);
  useEffect(() => {
    const language = () => setLayout((old) => ({ ...old, open: true, tab: 'language' }));
    const debug = () => setLayout((old) => ({ ...old, open: true, tab: 'debug' }));
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        setLayout((old) => ({ ...old, open: !old.open }));
      }
    };
    window.addEventListener('melinna-ide-action', language);
    window.addEventListener('melinna-ide-show-language', language);
    window.addEventListener('melinna-ide-breakpoint', debug);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('melinna-ide-action', language);
      window.removeEventListener('melinna-ide-show-language', language);
      window.removeEventListener('melinna-ide-breakpoint', debug);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const resize = (height: number) =>
    setLayout((old) => ({ ...old, height: Math.max(160, Math.min(600, height)) }));
  return (
    <section
      aria-label="Ferramentas de desenvolvimento"
      className={`ide-tools${layout.open ? '' : ' ide-tools-closed'}`}
      style={{ '--ide-height': `${layout.height}px` } as CSSProperties}
    >
      {layout.open && (
        <div
          role="separator"
          aria-label="Altura das ferramentas"
          aria-orientation="horizontal"
          aria-valuemin={160}
          aria-valuemax={600}
          aria-valuenow={layout.height}
          tabIndex={0}
          className="ide-resizer"
          onPointerDown={(event) => {
            drag.current = { y: event.clientY, height: layout.height };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              resize(layout.height + (event.key === 'ArrowUp' ? 20 : -20));
            }
          }}
        />
      )}
      <div className="ide-toolbar" ref={toolbar}>
        <div
          role="tablist"
          aria-label="Ferramentas IDE"
          onKeyDown={(event) => {
            const index = tabs.findIndex((tab) => tab.id === layout.tab);
            let next = index;
            if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
            else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = tabs.length - 1;
            else return;
            event.preventDefault();
            setLayout((old) => ({ ...old, open: true, tab: tabs[next]!.id }));
            toolbar.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`ide-tab-${tab.id}`}
              aria-controls={`ide-panel-${tab.id}`}
              aria-selected={layout.open && layout.tab === tab.id}
              tabIndex={layout.tab === tab.id ? 0 : -1}
              onClick={() => setLayout((old) => ({ ...old, open: true, tab: tab.id }))}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label={layout.open ? 'Recolher ferramentas IDE' : 'Expandir ferramentas IDE'}
          title="Ctrl+Alt+I"
          onClick={() => setLayout((old) => ({ ...old, open: !old.open }))}
        >
          {layout.open ? 'Recolher' : 'Expandir'}
        </button>
      </div>
      <div className="ide-tool-content" hidden={!layout.open}>
        <div
          role="tabpanel"
          id="ide-panel-language"
          aria-labelledby="ide-tab-language"
          hidden={layout.tab !== 'language'}
        >
          <LanguageTools roots={roots} editor={editor} onOpen={onOpen} />
        </div>
        <div
          role="tabpanel"
          id="ide-panel-debug"
          aria-labelledby="ide-tab-debug"
          hidden={layout.tab !== 'debug'}
        >
          <DebugTools roots={roots} onOpen={onOpen} onRun={onRun} />
        </div>
        <div
          role="tabpanel"
          id="ide-panel-http"
          aria-labelledby="ide-tab-http"
          hidden={layout.tab !== 'http'}
        >
          <HttpTools />
        </div>
        <div
          role="tabpanel"
          id="ide-panel-database"
          aria-labelledby="ide-tab-database"
          hidden={layout.tab !== 'database'}
        >
          <DatabaseTools />
        </div>
      </div>
    </section>
  );
}
