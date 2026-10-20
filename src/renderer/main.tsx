import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createLayoutStore } from './store/layout-store';
import { createWorkspaceStore } from './store/workspace-store';
import { createPortReceiver } from './terminal/port-receiver';
import { createXterm } from './terminal/xterm-factory';
import './theme/tokens.css';
import './styles/app.css';

function observeResize(el: HTMLElement, fn: () => void): () => void {
  const ro = new ResizeObserver(() => fn());
  ro.observe(el);
  return () => ro.disconnect();
}

const api = window.melinna;
const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App
        api={api}
        terminal={{ factory: createXterm, receiver: createPortReceiver(window), observeResize }}
        workspaceStore={createWorkspaceStore(api)}
        layoutStore={createLayoutStore(api)}
      />
    </StrictMode>,
  );
}
