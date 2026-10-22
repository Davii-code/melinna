#!/usr/bin/env bash
# Monta o pacote de distribuição para Linux: dist/melinna-linux-x64.tar.gz.
#
# Roda num Linux (ou WSL2) depois de "electron-builder --linux", que deixa o app montado em
# dist/linux-unpacked. É o que "npm run dist:linux" faz.
#
# Conteúdo do pacote:
#   melinna-linux-x64/
#     melinna/        o app (executável melinna-desk e os arquivos dele)
#     melinna.png     ícone do atalho
#     install.sh      instala para o usuário atual
#     uninstall.sh    remove
#     LEIA-ME.txt

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$ROOT/dist"
UNPACKED="$DIST/linux-unpacked"
NAME="melinna-linux-x64"
STAGE="$DIST/$NAME"
ARCHIVE="$DIST/$NAME.tar.gz"

[ "$(uname -s)" = "Linux" ] || { echo "Monte o pacote num Linux (ou WSL2)." >&2; exit 1; }
[ -x "$UNPACKED/melinna-desk" ] || {
  echo "Não encontrei $UNPACKED/melinna-desk. Rode antes: npx electron-vite build && npx electron-builder --linux" >&2
  exit 1
}

rm -rf "$STAGE" "$ARCHIVE"
mkdir -p "$STAGE"
cp -a "$UNPACKED" "$STAGE/melinna"
cp "$ROOT/build/icons/icon.png" "$STAGE/melinna.png"
cp "$ROOT/scripts/linux/install.sh" "$ROOT/scripts/linux/uninstall.sh" "$ROOT/scripts/linux/LEIA-ME.txt" "$STAGE/"
chmod +x "$STAGE/install.sh" "$STAGE/uninstall.sh" "$STAGE/melinna/melinna-desk"

tar -C "$DIST" -czf "$ARCHIVE" "$NAME"
echo "Pacote pronto: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
