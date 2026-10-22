#!/usr/bin/env bash
# Remove o Melinna instalado pelo install.sh (também disponível como "melinna-uninstall").
#
# Uso:
#   ./uninstall.sh            remove o app, o comando, o atalho e o ícone
#   ./uninstall.sh --purge    remove também os dados do usuário (~/.config/Melinna)
#   ./uninstall.sh --yes      não pergunta (o perfil do AppArmor, se houver, é removido com sudo)

set -euo pipefail

APP_ID="melinna"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
INSTALL_DIR="$HOME/.local/opt/$APP_ID"
LAUNCHER="$HOME/.local/bin/$APP_ID"
UNINSTALLER="$HOME/.local/bin/$APP_ID-uninstall"
DESKTOP_FILE="$DATA_HOME/applications/$APP_ID.desktop"
ICON_FILE="$DATA_HOME/icons/hicolor/512x512/apps/$APP_ID.png"
APPARMOR_PROFILE="/etc/apparmor.d/$APP_ID"
USER_DATA="$CONFIG_HOME/Melinna"
MARKER=".melinna-install"

ASSUME_YES=0
PURGE=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Opção desconhecida: $arg (use --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*" >&2; }

confirm() {
  local question="$1" default="${2:-s}" answer
  if [ "$ASSUME_YES" -eq 1 ]; then return 0; fi
  if [ ! -t 0 ]; then [ "$default" = "s" ]; return; fi
  read -r -p "$question [$( [ "$default" = "s" ] && echo "S/n" || echo "s/N" )] " answer || answer=""
  answer="${answer:-$default}"
  case "$answer" in s|S|sim|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

if [ -d "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/$MARKER" ]; then
  echo "$INSTALL_DIR não foi criado pelo instalador do Melinna; nada foi removido." >&2
  exit 1
fi

# O Melinna não pode estar aberto: o hospedeiro de terminais mantém processos vivos na pasta do app.
if command -v pgrep >/dev/null 2>&1 && pgrep -f "$INSTALL_DIR/" >/dev/null 2>&1; then
  warn "O Melinna (ou um terminal dele) ainda está rodando."
  confirm "Encerrar os processos do Melinna e continuar?" n || exit 1
  pkill -f "$INSTALL_DIR/" || true
  sleep 1
fi

say "Removendo o Melinna"
rm -rf "$INSTALL_DIR"
rm -f "$LAUNCHER" "$DESKTOP_FILE" "$ICON_FILE" "$UNINSTALLER"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true

if [ -f "$APPARMOR_PROFILE" ]; then
  if command -v sudo >/dev/null 2>&1 && confirm "Remover o perfil do AppArmor ($APPARMOR_PROFILE)? Pede a senha de sudo." s; then
    sudo apparmor_parser -R "$APPARMOR_PROFILE" 2>/dev/null || true
    sudo rm -f "$APPARMOR_PROFILE"
  else
    warn "Perfil do AppArmor mantido em $APPARMOR_PROFILE (remova com sudo quando quiser)."
  fi
fi

if [ "$PURGE" -eq 1 ]; then
  if [ -d "$USER_DATA" ] && confirm "Apagar também os dados do Melinna em $USER_DATA (workspaces e histórico dos terminais)?" n; then
    rm -rf "$USER_DATA"
    say "Dados do usuário apagados."
  fi
else
  echo "Os dados do usuário ficaram em $USER_DATA (use --purge para apagar)."
fi

say "Melinna removido."
