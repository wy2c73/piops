#!/usr/bin/env bash
#
# PiOps -- one-line installer
#
#   curl -sSL https://raw.githubusercontent.com/wy2c73/piops/main/install.sh | bash
#
# Defaults to cloning from github.com/wy2c73/piops (see REPO_URL below).
# Override with PIOPS_REPO_URL if you've forked this or want to run it
# against a different repo, e.g.:
#   curl -sSL <script-url> | PIOPS_REPO_URL=https://github.com/you/piops.git bash
#
# What this does, in order -- every step is logged as it runs, nothing
# happens silently:
#   1. Checks you're on a Debian-family Linux (Raspberry Pi OS/Debian/Ubuntu)
#   2. Installs git and/or Node.js 20.x via NodeSource if not already present
#   3. Clones this repo into /opt/piops -- or, if it's already there,
#      updates it in place instead of starting over
#   4. Creates a dedicated, unprivileged system user to run it as
#   5. Installs npm dependencies
#   6. Writes and enables a systemd service so it survives reboots
#   7. Prints the URL(s) to open it from
#
# Safe to re-run: this is the same script you'd use to update later.
# Your device registry, encryption key, and other data (all under
# backend/data/) are never touched by any of this.
#
# This is a plain, readable bash script with nothing hidden -- reading it
# before running it (rather than piping straight to bash) is reasonable
# and easy; it's well under 200 lines.

set -euo pipefail

# ---- Configuration (override via environment variables) ----
REPO_URL="${PIOPS_REPO_URL:-https://github.com/wy2c73/piops.git}"
INSTALL_DIR="${PIOPS_INSTALL_DIR:-/opt/piops}"
SERVICE_USER="${PIOPS_SERVICE_USER:-piops}"
PORT="${PIOPS_PORT:-3000}"
NODE_MAJOR="${PIOPS_NODE_MAJOR:-20}"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

# ---- 1. Sanity checks ----
if ! command -v apt-get >/dev/null 2>&1; then
  die "This installer targets Debian-family Linux (Raspberry Pi OS/Debian/Ubuntu) with apt-get. See INSTALL.md for a manual walkthrough on other systems."
fi

SUDO=""
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    die "This needs root for a few steps (installing packages, creating a system user, systemd) and sudo isn't available. Re-run as root, or see INSTALL.md for the manual steps."
  fi
fi

# Runs a command as $SERVICE_USER regardless of whether we're already
# root (uses su) or need to elevate via sudo -- so it works either way
# without assuming sudo is installed when we're already root.
#
# Explicitly passes HOME rather than trusting `su`/`sudo` to set it
# correctly on their own -- they turned out to disagree: a non-login
# `su user -c cmd` doesn't reset HOME at all (inherits the caller's),
# while `sudo -u user cmd` does. Being explicit here means this doesn't
# depend on which of the two paths runs, or on any distro's specific
# defaults for either.
run_as_service_user() {
  local home
  home="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  if [[ $EUID -eq 0 ]]; then
    su -s /bin/bash "$SERVICE_USER" -c "HOME='$home' $1"
  else
    sudo -u "$SERVICE_USER" HOME="$home" bash -c "$1"
  fi
}

# ---- 2. git + Node.js ----
if ! command -v git >/dev/null 2>&1; then
  log "Installing git"
  $SUDO apt-get install -y git
fi

NEED_NODE=true
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [[ "$CURRENT_MAJOR" -ge 18 ]]; then
    NEED_NODE=false
    log "Node.js $(node -v) already installed, skipping"
  fi
fi
if [[ "$NEED_NODE" == true ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x via NodeSource"
  if [[ -n "$SUDO" ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  else
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  fi
  $SUDO apt-get install -y nodejs
fi

# ---- 3. Dedicated system user ----
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "Creating system user '$SERVICE_USER'"
  $SUDO useradd -r -s /usr/sbin/nologin "$SERVICE_USER"
else
  log "System user '$SERVICE_USER' already exists, skipping"
fi

# useradd -r does not create a home directory by default on Debian/
# Raspberry Pi OS, but the user still gets one *assigned* in /etc/passwd
# (typically /home/$SERVICE_USER) -- so anything that needs to write
# there (npm's cache being the notable one) fails with a permission
# error on a directory that was never actually created. Fix this
# regardless of whether the user above was just created or already
# existed, since an existing user could already be in this broken state.
SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
if [[ -z "$SERVICE_HOME" || "$SERVICE_HOME" == "/" ]]; then
  SERVICE_HOME="/home/$SERVICE_USER"
  $SUDO usermod -d "$SERVICE_HOME" "$SERVICE_USER"
fi
if [[ ! -d "$SERVICE_HOME" ]]; then
  log "Creating home directory $SERVICE_HOME for '$SERVICE_USER'"
  $SUDO mkdir -p "$SERVICE_HOME"
  $SUDO chown "$SERVICE_USER:$SERVICE_USER" "$SERVICE_HOME"
fi

# ---- 4. Get the project (cloned/updated AS the service user from the
# start, not as root+chown-after -- git refuses to operate on a repo
# owned by a different user than the one running it, which would break
# every future "update" run of this same script if root ever touched it) ----
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "Already installed at $INSTALL_DIR -- updating instead of reinstalling"
  run_as_service_user "git -C '$INSTALL_DIR' pull --ff-only"
else
  log "Cloning into $INSTALL_DIR"
  $SUDO mkdir -p "$INSTALL_DIR"
  $SUDO chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
  run_as_service_user "git clone '$REPO_URL' '$INSTALL_DIR'"
fi

# ---- 5. Dependencies ----
log "Installing npm dependencies"
run_as_service_user "cd '$INSTALL_DIR/backend' && npm install --omit=dev"

# ---- 6. systemd service ----
SERVICE_FILE="/etc/systemd/system/piops.service"

# If REPO_URL is a plain github.com HTTPS URL, derive "owner/repo" so the
# dashboard's "update available" badge (Settings -> General shows it,
# powered by GITHUB_REPO) works immediately with no extra configuration.
# Echoes nothing -- the badge just stays off, same as if this were never
# run -- for anything this doesn't recognize (a fork hosted elsewhere,
# an SSH-style URL, a local path used for testing). A named function
# (rather than this logic inline) so test/install-logic.test.js can
# source this file and exercise it directly instead of duplicating it.
derive_github_repo_slug() {
  local url="$1"
  if [[ "$url" =~ ^https://github\.com/([^/]+)/([^/]+)/?$ ]]; then
    echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
  fi
}

GITHUB_REPO_SLUG="$(derive_github_repo_slug "$REPO_URL")"

log "Writing $SERVICE_FILE"
$SUDO tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=PiOps
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
User=${SERVICE_USER}
Environment=PORT=${PORT}
$( [[ -n "$GITHUB_REPO_SLUG" ]] && echo "Environment=GITHUB_REPO=${GITHUB_REPO_SLUG}" )

[Install]
WantedBy=multi-user.target
EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable piops
$SUDO systemctl restart piops  # restart, not start -- picks up an update if this was a re-run

# ---- 7. Done ----
sleep 2
if $SUDO systemctl is-active --quiet piops; then
  log "Installed and running."
else
  warn "Installed, but the service doesn't look active. Check: sudo systemctl status piops"
fi

LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Open the dashboard at:"
echo "  http://localhost:${PORT}"
[[ -n "$LOCAL_IP" ]] && echo "  http://${LOCAL_IP}:${PORT}"
echo
echo "If you can't reach it from another device, check the firewall, e.g.:"
echo "  sudo ufw allow ${PORT}/tcp"
echo
echo "Logs: sudo journalctl -u piops -f"
