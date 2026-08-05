#!/usr/bin/env bash
#
# PiOps -- one-line uninstaller (native/systemd install)
#
#   curl -sSL https://raw.githubusercontent.com/wy2c73/piops/main/uninstall.sh | bash
#
# Removes the systemd service, the install directory (including your
# device registry and encryption key), and the dedicated system user
# created by install.sh. Asks for confirmation first -- this is
# destructive and cannot be undone.
#
# If you want to keep your device list, export a backup first
# (Settings -> Backup -> Export backup) before running this.
#
# Only for a native (systemd) install. For a Docker install, see
# UNINSTALL.md instead -- `docker compose down` + removing the project
# folder covers it, no separate script needed.
#
# Non-interactive use (e.g. scripted): set PIOPS_UNINSTALL_YES=1 to
# skip the confirmation prompt.

set -euo pipefail

INSTALL_DIR="${PIOPS_INSTALL_DIR:-/opt/piops}"
SERVICE_USER="${PIOPS_SERVICE_USER:-piops}"
SERVICE_NAME="piops"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

SUDO=""
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    die "This needs root to stop the service and remove system files. Re-run as root, or see UNINSTALL.md for the manual steps."
  fi
fi

echo "This will permanently remove:"
echo "  - the ${SERVICE_NAME} systemd service"
echo "  - ${INSTALL_DIR} (including your device registry and encryption key)"
echo "  - the '${SERVICE_USER}' system user"
echo
echo "If you want to keep your device list, export a backup first"
echo "(Settings -> Backup -> Export backup), then press Ctrl+C now."

if [[ "${PIOPS_UNINSTALL_YES:-}" != "1" ]]; then
  if [[ ! -r /dev/tty ]]; then
    die "No terminal available to confirm against. Set PIOPS_UNINSTALL_YES=1 to skip this prompt (e.g. for scripted use)."
  fi
  echo
  read -r -p "Type 'yes' to continue: " confirm < /dev/tty
  if [[ "$confirm" != "yes" ]]; then
    echo "Cancelled -- nothing was removed."
    exit 0
  fi
fi

if [[ -f "/etc/systemd/system/${SERVICE_NAME}.service" ]]; then
  log "Stopping and disabling the ${SERVICE_NAME} service"
  $SUDO systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  $SUDO systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  $SUDO rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload 2>/dev/null || true
else
  warn "No ${SERVICE_NAME}.service found -- skipping service removal"
fi

if [[ -d "$INSTALL_DIR" ]]; then
  log "Removing $INSTALL_DIR"
  $SUDO rm -rf "$INSTALL_DIR"
else
  warn "$INSTALL_DIR doesn't exist -- skipping"
fi

if id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Removing system user '$SERVICE_USER'"
  $SUDO userdel -r "$SERVICE_USER" 2>/dev/null || warn "Could not fully remove the system user -- you may want to run 'sudo userdel $SERVICE_USER' manually"
else
  warn "System user '$SERVICE_USER' doesn't exist -- skipping"
fi

log "PiOps has been removed."
echo
echo "Optional further cleanup (Node.js, firewall rules, sudoers entries on"
echo "monitored Pis, browser data, terminal protocol handlers) is covered in"
echo "UNINSTALL.md if you want a fully clean machine."
