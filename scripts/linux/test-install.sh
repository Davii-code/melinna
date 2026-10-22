#!/usr/bin/env bash
# Testa o install.sh e o uninstall.sh sem tocar no usuário real: usa um HOME temporário e um app falso
# no lugar do Melinna (não precisa do build). Não usa sudo.
#
# Uso, de qualquer pasta:
#   bash scripts/linux/test-install.sh
#
# Em contêineres de outras distribuições (com Docker), a partir da raiz do projeto:
#   docker run --rm -v "$PWD:/src:ro" ubuntu:24.04 bash /src/scripts/linux/test-install.sh
#   docker run --rm -v "$PWD:/src:ro" fedora:40    bash /src/scripts/linux/test-install.sh
#   docker run --rm -v "$PWD:/src:ro" archlinux    bash /src/scripts/linux/test-install.sh

set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  \033[32mok\033[0m   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31mFALHA\033[0m %s\n' "$1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Pacote falso, com a mesma estrutura do melinna-linux-x64.
PKG="$WORK/melinna-linux-x64"
mkdir -p "$PKG/melinna"
printf '#!/bin/sh\necho "melinna-falso $*"\n' >"$PKG/melinna/melinna-desk"
chmod +x "$PKG/melinna/melinna-desk"
touch "$PKG/melinna/chrome-sandbox"
printf 'png' >"$PKG/melinna.png"
cp "$SCRIPTS/install.sh" "$SCRIPTS/uninstall.sh" "$PKG/"
chmod +x "$PKG/install.sh" "$PKG/uninstall.sh"

export HOME="$WORK/home"
mkdir -p "$HOME"
unset XDG_DATA_HOME XDG_CONFIG_HOME
DATA="$HOME/.local/share"

echo "Instalação"
"$PKG/install.sh" --yes --sandbox=off </dev/null >"$WORK/install.log" 2>&1 || { cat "$WORK/install.log"; bad "install.sh terminou com erro"; }
check "app copiado para ~/.local/opt/melinna" '[ -x "$HOME/.local/opt/melinna/melinna-desk" ]'
check "marcador da instalação gravado" '[ -f "$HOME/.local/opt/melinna/.melinna-install" ]'
check "comando melinna criado" '[ -x "$HOME/.local/bin/melinna" ]'
check "comando melinna-uninstall criado" '[ -x "$HOME/.local/bin/melinna-uninstall" ]'
check "comando abre o app com --no-sandbox (pedido em --sandbox=off)" 'grep -q -- "--no-sandbox" "$HOME/.local/bin/melinna"'
check "comando executa o app" '"$HOME/.local/bin/melinna" --teste | grep -q "melinna-falso --no-sandbox --teste"'
check "atalho .desktop criado" '[ -f "$DATA/applications/melinna.desktop" ]'
check "atalho aponta para o comando" 'grep -q "Exec=\"$HOME/.local/bin/melinna\" %U" "$DATA/applications/melinna.desktop"'
check "ícone copiado" '[ -f "$DATA/icons/hicolor/512x512/apps/melinna.png" ]'

echo "Atualização (rodar de novo)"
echo "versao-antiga" >"$HOME/.local/opt/melinna/sobra.txt"
"$PKG/install.sh" --yes --sandbox=off </dev/null >"$WORK/update.log" 2>&1 || { cat "$WORK/update.log"; bad "segunda instalação terminou com erro"; }
check "arquivos da versão anterior saem" '[ ! -e "$HOME/.local/opt/melinna/sobra.txt" ]'
check "app continua instalado" '[ -x "$HOME/.local/opt/melinna/melinna-desk" ]'

echo "Proteção de pasta alheia"
mkdir -p "$WORK/home2/.local/opt/melinna"
if HOME="$WORK/home2" "$PKG/install.sh" --yes --sandbox=off </dev/null >"$WORK/alheia.log" 2>&1; then
  bad "deveria recusar instalar por cima de uma pasta que não é dele"
else
  ok "recusa instalar por cima de uma pasta que não é dele"
fi
check "pasta alheia continua lá" '[ -d "$WORK/home2/.local/opt/melinna" ]'

echo "Opções inválidas"
if "$PKG/install.sh" --sandbox=talvez </dev/null >/dev/null 2>&1; then bad "aceitou --sandbox=talvez"; else ok "recusa --sandbox inválido"; fi

echo "Remoção"
mkdir -p "$HOME/.config/Melinna"
echo "{}" >"$HOME/.config/Melinna/state.json"
"$HOME/.local/bin/melinna-uninstall" --yes </dev/null >"$WORK/uninstall.log" 2>&1 || { cat "$WORK/uninstall.log"; bad "uninstall terminou com erro"; }
check "app removido" '[ ! -e "$HOME/.local/opt/melinna" ]'
check "comando removido" '[ ! -e "$HOME/.local/bin/melinna" ]'
check "desinstalador removido" '[ ! -e "$HOME/.local/bin/melinna-uninstall" ]'
check "atalho removido" '[ ! -e "$DATA/applications/melinna.desktop" ]'
check "ícone removido" '[ ! -e "$DATA/icons/hicolor/512x512/apps/melinna.png" ]'
check "dados do usuário mantidos sem --purge" '[ -f "$HOME/.config/Melinna/state.json" ]'

echo "Remoção com --purge"
"$PKG/install.sh" --yes --sandbox=off </dev/null >/dev/null 2>&1
"$PKG/uninstall.sh" --yes --purge </dev/null >/dev/null 2>&1
check "dados do usuário apagados com --purge" '[ ! -e "$HOME/.config/Melinna" ]'

echo
echo "Resultado: $PASS ok, $FAIL falha(s)"
[ "$FAIL" -eq 0 ]
