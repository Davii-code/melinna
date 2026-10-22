#!/usr/bin/env bash
# Instala o Melinna para o usuário atual, em qualquer distribuição Linux x64.
#
# Uso (de dentro da pasta descompactada do pacote):
#   ./install.sh                     instala, perguntando quando precisar de sudo
#   ./install.sh --yes               aceita as sugestões sem perguntar
#   ./install.sh --sandbox=MODO      auto (padrão) | apparmor | suid | off
#
# O que faz:
#   1. copia o app para ~/.local/opt/melinna
#   2. cria o comando "melinna" em ~/.local/bin
#   3. cria o atalho no menu de aplicativos e o ícone
#   4. ajusta o isolamento (sandbox) do Electron quando a distribuição restringe
#   5. confere dependências e mostra o comando para instalar o que faltar
#
# Os dados do usuário (workspaces, histórico) ficam em ~/.config/Melinna e não são tocados.

set -euo pipefail

APP_ID="melinna"
EXECUTABLE="melinna-desk"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/melinna"
ICON_SRC="$SCRIPT_DIR/melinna.png"

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
INSTALL_DIR="$HOME/.local/opt/$APP_ID"
BIN_DIR="$HOME/.local/bin"
LAUNCHER="$BIN_DIR/$APP_ID"
UNINSTALLER="$BIN_DIR/$APP_ID-uninstall"
DESKTOP_FILE="$DATA_HOME/applications/$APP_ID.desktop"
ICON_FILE="$DATA_HOME/icons/hicolor/512x512/apps/$APP_ID.png"
APPARMOR_PROFILE="/etc/apparmor.d/$APP_ID"
MARKER=".melinna-install"

ASSUME_YES=0
SANDBOX_MODE="auto"

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --sandbox=*) SANDBOX_MODE="${arg#--sandbox=}" ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $arg (use --help)" >&2
      exit 2
      ;;
  esac
done

case "$SANDBOX_MODE" in
  auto|apparmor|suid|off) ;;
  *) echo "Valor inválido para --sandbox: $SANDBOX_MODE (auto, apparmor, suid ou off)" >&2; exit 2 ;;
esac

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }

# Pergunta sim/não; com --yes ou sem terminal interativo, usa a resposta padrão.
confirm() {
  local question="$1" default="${2:-s}" answer
  if [ "$ASSUME_YES" -eq 1 ]; then return 0; fi
  if [ ! -t 0 ]; then [ "$default" = "s" ]; return; fi
  read -r -p "$question [$( [ "$default" = "s" ] && echo "S/n" || echo "s/N" )] " answer || answer=""
  answer="${answer:-$default}"
  case "$answer" in s|S|sim|y|Y|yes) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- verificações
[ "$(uname -s)" = "Linux" ] || fail "Este instalador é para Linux."
case "$(uname -m)" in
  x86_64|amd64) ;;
  *) fail "Este pacote é para x64; a máquina é $(uname -m)." ;;
esac
if [ "$(id -u)" -eq 0 ]; then
  warn "Rodando como root: o Melinna será instalado para o root, não para o seu usuário."
  confirm "Continuar mesmo assim?" n || exit 1
fi
[ -x "$SRC_DIR/$EXECUTABLE" ] || fail "Não encontrei $SRC_DIR/$EXECUTABLE. Rode o install.sh de dentro da pasta descompactada do pacote."

# ---------------------------------------------------------------- cópia do app
if [ -e "$INSTALL_DIR" ]; then
  [ -f "$INSTALL_DIR/$MARKER" ] || fail "$INSTALL_DIR já existe e não foi criado por este instalador; remova-o ou mova-o antes."
  say "Atualizando a instalação em $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
else
  say "Instalando em $INSTALL_DIR"
fi
mkdir -p "$(dirname "$INSTALL_DIR")"
cp -a "$SRC_DIR" "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/$EXECUTABLE"

# ---------------------------------------------------------------- sandbox
# O Electron isola o renderizador com namespaces de usuário. Algumas distribuições bloqueiam isso:
#  - Ubuntu 23.10+ (AppArmor): kernel.apparmor_restrict_unprivileged_userns = 1 -> perfil do AppArmor;
#  - kernels com kernel.unprivileged_userns_clone = 0 (Debian antigo etc.) -> chrome-sandbox SUID root.
# Sem sudo, o último recurso é abrir com --no-sandbox (menos isolamento do Chromium).
read_sysctl() { [ -r "$1" ] && cat "$1" 2>/dev/null || echo ""; }

needed="none"
if [ "$(read_sysctl /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1" ]; then
  needed="apparmor"
elif [ "$(read_sysctl /proc/sys/kernel/unprivileged_userns_clone)" = "0" ]; then
  needed="suid"
fi

mode="$SANDBOX_MODE"
if [ "$mode" = "auto" ]; then mode="$needed"; fi

have_sudo() { command -v sudo >/dev/null 2>&1; }

install_apparmor() {
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# Perfil do Melinna: libera os namespaces de usuário que o Electron usa para o sandbox.
abi <abi/4.0>,
include <tunables/global>

profile $APP_ID "$INSTALL_DIR/$EXECUTABLE" flags=(unconfined) {
  userns,

  include if exists <local/$APP_ID>
}
EOF
  sudo install -m 0644 "$tmp" "$APPARMOR_PROFILE" && sudo apparmor_parser -r "$APPARMOR_PROFILE"
  local status=$?
  rm -f "$tmp"
  return $status
}

install_suid() {
  sudo chown root:root "$INSTALL_DIR/chrome-sandbox" && sudo chmod 4755 "$INSTALL_DIR/chrome-sandbox"
}

launch_flags=""
sandbox_result="padrão"
case "$mode" in
  none)
    sandbox_result="padrão (nada a ajustar)"
    ;;
  apparmor)
    say "Esta distribuição restringe o sandbox do Electron (AppArmor)."
    if have_sudo && command -v apparmor_parser >/dev/null 2>&1 \
      && confirm "Instalar um perfil do AppArmor para o Melinna? Pede a senha de sudo uma vez." s \
      && install_apparmor; then
      sandbox_result="perfil do AppArmor em $APPARMOR_PROFILE"
    else
      warn "Perfil do AppArmor não instalado: o Melinna vai abrir com --no-sandbox."
      launch_flags="--no-sandbox"
      sandbox_result="--no-sandbox"
    fi
    ;;
  suid)
    say "Esta distribuição desativa os namespaces de usuário: o Electron precisa do chrome-sandbox como root."
    if have_sudo && confirm "Ajustar o chrome-sandbox com sudo (chown root, chmod 4755)?" s && install_suid; then
      sandbox_result="chrome-sandbox SUID root"
    else
      warn "chrome-sandbox não ajustado: o Melinna vai abrir com --no-sandbox."
      launch_flags="--no-sandbox"
      sandbox_result="--no-sandbox"
    fi
    ;;
  off)
    warn "Sandbox desligado a pedido (--sandbox=off): o Melinna vai abrir com --no-sandbox."
    launch_flags="--no-sandbox"
    sandbox_result="--no-sandbox"
    ;;
esac

# ---------------------------------------------------------------- comando, atalho e ícone
mkdir -p "$BIN_DIR" "$(dirname "$DESKTOP_FILE")" "$(dirname "$ICON_FILE")"

cat >"$LAUNCHER" <<EOF
#!/usr/bin/env sh
# Gerado pelo instalador do Melinna.
exec "$INSTALL_DIR/$EXECUTABLE" $launch_flags "\$@"
EOF
chmod +x "$LAUNCHER"

# O desinstalador fica disponível depois que a pasta do pacote for apagada.
if [ -f "$SCRIPT_DIR/uninstall.sh" ]; then
  cp "$SCRIPT_DIR/uninstall.sh" "$UNINSTALLER"
  chmod +x "$UNINSTALLER"
fi

if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_FILE"
else
  warn "Ícone não encontrado no pacote; o atalho fica sem ícone."
fi

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Melinna
GenericName=Workspace de agentes de código
Comment=Vários agentes de código em paralelo, cada um num terminal vivo
Exec="$LAUNCHER" %U
Icon=$APP_ID
Terminal=false
Categories=Development;
StartupWMClass=Melinna
EOF

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$(dirname "$DESKTOP_FILE")" >/dev/null 2>&1 || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true

cat >"$INSTALL_DIR/$MARKER" <<EOF
installed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sandbox=$sandbox_result
apparmor_profile=$( [ -f "$APPARMOR_PROFILE" ] && echo "$APPARMOR_PROFILE" || echo "" )
EOF

# ---------------------------------------------------------------- dependências
distro_id=""
distro_like=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  distro_id="${ID:-}"
  distro_like="${ID_LIKE:-}"
fi

pkg_hint() {
  local pkgs="$1"
  case " $distro_id $distro_like " in
    *" ubuntu "*|*" debian "*) echo "sudo apt install -y $pkgs" ;;
    *" fedora "*|*" rhel "*|*" centos "*) echo "sudo dnf install -y $pkgs" ;;
    *" arch "*) echo "sudo pacman -S --needed $pkgs" ;;
    *" opensuse"*|*" suse "*) echo "sudo zypper install -y $pkgs" ;;
    *) echo "instale pelo gerenciador de pacotes da sua distribuição: $pkgs" ;;
  esac
}

missing_tools=""
command -v git >/dev/null 2>&1 || missing_tools="$missing_tools git"

missing_libs=""
if command -v ldd >/dev/null 2>&1; then
  missing_libs="$(ldd "$INSTALL_DIR/$EXECUTABLE" 2>/dev/null | awk '/not found/ {print $1}' | tr '\n' ' ' || true)"
fi

# ---------------------------------------------------------------- resumo
echo
say "Melinna instalado."
echo "    app:      $INSTALL_DIR"
echo "    comando:  $LAUNCHER"
echo "    atalho:   $DESKTOP_FILE"
echo "    sandbox:  $sandbox_result"
echo "    remover:  $UNINSTALLER"

if [ -n "$missing_tools" ]; then
  echo
  warn "Falta:$missing_tools. O Melinna usa o git nas pastas que são repositórios."
  echo "    $(pkg_hint "${missing_tools# }")"
fi
if [ -n "$missing_libs" ]; then
  echo
  warn "Bibliotecas do sistema não encontradas: $missing_libs"
  echo "    Em geral resolvem com: $(pkg_hint "libnss3 libgtk-3-0 libasound2 libgbm1 libxss1")"
  echo "    (os nomes mudam entre distribuições; procure pelos arquivos listados acima)"
fi
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo
    warn "$BIN_DIR não está no PATH: o comando \"melinna\" só funciona depois de acrescentá-lo."
    echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.profile   (e abra um terminal novo)"
    ;;
esac
command -v claude >/dev/null 2>&1 || {
  echo
  echo "Dica: instale ao menos um agente de CLI (Claude Code, Codex ou Gemini) para usar o Melinna;"
  echo "      sem eles, o app abre só os shells do sistema."
}
echo
echo "Abra pelo menu de aplicativos (Melinna) ou rode: melinna"
