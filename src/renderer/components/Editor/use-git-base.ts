import { useEffect, useMemo, useState } from 'react';
import { useOptionalApi } from '../../api';
import { useOptionalGitWorkspace } from '../../git/git-workspace';

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** A pasta do workspace (com o id) que contém o arquivo; a mais funda quando uma está dentro da outra. */
function folderOf(folders: readonly { id: string; path: string }[], path: string) {
  const target = normalize(path);
  let best: { id: string; path: string } | null = null;
  for (const folder of folders) {
    const root = normalize(folder.path);
    if (!target.startsWith(`${root}/`)) continue;
    if (best === null || root.length > normalize(best.path).length) best = folder;
  }
  return best;
}

/**
 * Texto do arquivo no último commit, para a margem do git; `null` sem base (fora de git, arquivo novo,
 * binário, grande demais). Relê quando o `HEAD` do repositório muda (commit pelo painel, por um agente ou
 * por fora, visto pelo `status`) e quando a janela volta a ter o foco.
 */
export function useGitBase(path: string | null): string | null {
  const api = useOptionalApi();
  const git = useOptionalGitWorkspace();
  const [base, setBase] = useState<string | null>(null);
  const [focusTick, setFocusTick] = useState(0);

  const folder = useMemo(
    () => (path === null || !git?.workspace ? null : folderOf(git.workspace.folders ?? [], path)),
    [git?.workspace, path],
  );
  const repo = folder === null ? undefined : git?.repos.find((r) => r.folderId === folder.id);
  const head = repo?.status.head ?? null;
  const tracked = repo !== undefined;

  useEffect(() => {
    const onFocus = () => setFocusTick((n) => n + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    if (api === null || path === null || folder === null || !tracked) {
      setBase(null);
      return;
    }
    let alive = true;
    void api.git.fileAtHead(folder.path, path).then((r) => {
      if (alive) setBase(r.ok && 'text' in r.value ? r.value.text : null);
    });
    return () => {
      alive = false;
    };
  }, [api, path, folder, tracked, head, focusTick]);

  return base;
}
