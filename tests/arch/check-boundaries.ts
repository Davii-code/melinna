import { builtinModules } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export interface Violation {
  file: string;
  specifier: string;
  rule: string;
}

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...listSources(abs));
    else if (/\.(ts|tsx|mts|cts)$/.test(name) && !name.endsWith('.d.ts')) out.push(abs);
  }
  return out;
}

export function importsOf(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const e = node.moduleReference.expression;
      if (ts.isStringLiteral(e)) specs.push(e.text);
    } else if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((isImport || isRequire) && arg && ts.isStringLiteral(arg)) specs.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

function packageName(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0] ?? spec;
}

/** Verifica as fronteiras entre camadas em `<root>/src`. Caminhos nas violações são relativos a `root`. */
export function checkBoundaries(root: string): Violation[] {
  const srcDir = join(root, 'src');
  const violations: Violation[] = [];
  for (const file of listSources(srcDir)) {
    const rel = relative(root, file).split('\\').join('/');
    for (const spec of importsOf(file)) {
      const isRelative = spec.startsWith('.');
      const target = isRelative
        ? relative(root, resolve(dirname(file), spec))
            .split('\\')
            .join('/')
        : null;
      const pkg = isRelative ? null : packageName(spec);
      const inside = (prefix: string) =>
        target !== null && (target === prefix || target.startsWith(`${prefix}/`));
      const add = (rule: string) => violations.push({ file: rel, specifier: spec, rule });

      if (rel.startsWith('src/core/')) {
        if (pkg && ['electron', 'node-pty', 'react', 'react-dom'].includes(pkg))
          add('core-forbidden-package');
        if (pkg?.startsWith('@xterm/')) add('core-forbidden-package');
        if (['src/main', 'src/preload', 'src/renderer', 'src/host', 'src/adapters'].some(inside))
          add('core-forbidden-layer');
      }
      if (rel.startsWith('src/adapters/') || rel.startsWith('src/host/')) {
        if (pkg === 'electron') add('no-electron');
      }
      if (rel.startsWith('src/renderer/')) {
        if (pkg && (BUILTINS.has(spec) || BUILTINS.has(pkg))) add('renderer-node-builtin');
        if (inside('src/main')) add('renderer-forbidden-layer');
        if (inside('src/core') && !inside('src/core/layout')) add('renderer-forbidden-layer');
      }
    }
  }
  return violations;
}
