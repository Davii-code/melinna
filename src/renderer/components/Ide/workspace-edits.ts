import { object } from '../../../shared/ide-types';
import { uriPath } from '../../../shared/ide-paths';
import type { Draft, DraftStore } from '../Editor/editor-session';

export interface Position {
  line: number;
  character: number;
}
export interface TextEdit {
  range: { start: Position; end: Position };
  newText: string;
}
interface FileSnapshot {
  path: string;
  before: Draft | undefined;
  hash: string;
  text: string;
  next: string;
}
export function positionOffset(text: string, value: unknown): number {
  const p = object(value);
  const lines = text.split('\n');
  if (
    !Number.isInteger(p.line) ||
    !Number.isInteger(p.character) ||
    (p.line as number) < 0 ||
    (p.line as number) >= lines.length ||
    (p.character as number) < 0
  )
    throw new Error('Posição de edição inválida.');
  const line = lines[p.line as number]!;
  if ((p.character as number) > line.replace(/\r$/, '').length) throw new Error('Coluna de edição inválida.');
  return (
    lines.slice(0, p.line as number).reduce((sum, line) => sum + line.length + 1, 0) + (p.character as number)
  );
}
export async function prepareWorkspaceEdit(
  raw: unknown,
  drafts: DraftStore,
  read: (path: string) => Promise<{ content: string; hash: string; binary: boolean; truncated: boolean }>,
  versions: ReadonlyMap<string, number>,
) {
  const edit = object(raw);
  const groups = new Map<string, { edits: unknown[]; version?: unknown }>();
  if (edit.changes)
    for (const [uri, values] of Object.entries(object(edit.changes))) {
      if (!Array.isArray(values)) throw new Error('Edits inválidos.');
      groups.set(uri, { edits: values });
    }
  if (edit.documentChanges) {
    if (!Array.isArray(edit.documentChanges)) throw new Error('Edits inválidos.');
    for (const rawChange of edit.documentChanges) {
      const change = object(rawChange);
      if (change.kind || !Array.isArray(change.edits))
        throw new Error('Criação, remoção e movimentação de arquivos não suportadas.');
      const doc = object(change.textDocument);
      if (typeof doc.uri !== 'string' || groups.has(doc.uri))
        throw new Error('Documento repetido na alteração.');
      groups.set(doc.uri, { edits: change.edits, version: doc.version });
    }
  }
  if (!groups.size || groups.size > 100) throw new Error('A ação não contém alterações de texto suportadas.');
  const snapshots: FileSnapshot[] = [];
  const paths = new Set<string>();
  for (const [uri, group] of groups) {
    const path = uriPath(uri);
    const key = /^[A-Za-z]:/.test(path) ? path.toLowerCase() : path;
    if (paths.has(key)) throw new Error('Arquivo repetido na alteração.');
    paths.add(key);
    const before = drafts.snapshot()[path];
    if (group.version !== undefined && group.version !== null && group.version !== versions.get(uri))
      throw new Error('Versão do documento mudou.');
    const disk = await read(path);
    if (disk.binary || disk.truncated) throw new Error('Arquivo binário ou acima do limite.');
    const text = before?.text ?? disk.content;
    if (before && before.baseHash !== disk.hash)
      throw new Error('Arquivo mudou em disco. Recarregue antes de aplicar a alteração.');
    if (group.edits.length > 10000) throw new Error('Quantidade de edits excedida.');
    const changes = group.edits
      .map((raw) => {
        const e = object(raw);
        const range = object(e.range);
        if (typeof e.newText !== 'string') throw new Error('Texto inválido.');
        return {
          from: positionOffset(text, range.start),
          to: positionOffset(text, range.end),
          insert: e.newText,
        };
      })
      .sort((a, b) => a.from - b.from || a.to - b.to);
    for (let i = 0; i < changes.length; i++) {
      const current = changes[i]!;
      const previous = changes[i - 1];
      if (
        current.to < current.from ||
        (previous && (current.from < previous.to || current.from === previous.from))
      )
        throw new Error('Alterações sobrepostas.');
    }
    let next = text;
    for (const change of [...changes].reverse())
      next = next.slice(0, change.from) + change.insert + next.slice(change.to);
    if (next.length > 5 * 1024 * 1024) throw new Error('Resultado acima do limite.');
    snapshots.push({ path, before, text, hash: disk.hash, next });
  }
  return {
    files: snapshots.map(({ path, text, next }) => ({ path, before: text, after: next })),
    async apply() {
      for (const snapshot of snapshots) {
        const disk = await read(snapshot.path);
        if (disk.hash !== snapshot.hash)
          throw new Error('Um arquivo mudou em disco. Nenhuma alteração aplicada.');
      }
      if (snapshots.some((s) => drafts.snapshot()[s.path] !== s.before))
        throw new Error('Um rascunho mudou. Nenhuma alteração aplicada.');
      drafts.setMany(
        Object.fromEntries(snapshots.map((s) => [s.path, { text: s.next, baseHash: s.hash, dirty: true }])),
      );
    },
  };
}
