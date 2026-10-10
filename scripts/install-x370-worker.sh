#!/usr/bin/env bash
# Install the Movies Wrapped Camoufox worker as a systemd --user service on Omarchy/Linux.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
VENV="${MOVIESWRAPPED_VENV:-$HOME/.local/share/movieswrapped/venv}"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/movieswrapped/worker.env"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/movieswrapped-worker.service"
PYTHON="${PYTHON:-python3}"

if [[ ! -d "$BACKEND" ]]; then
  echo "Cannot find backend/ under $REPO_ROOT" >&2
  exit 1
fi

mkdir -p "$(dirname "$ENV_FILE")" "$UNIT_DIR" "$(dirname "$VENV")" \
  "$HOME/.local/share/movieswrapped/camoufox-profile"

echo "Creating venv at $VENV"
"$PYTHON" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND/requirements.txt" -r "$BACKEND/requirements-worker.txt"
python -m camoufox fetch

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
# Same WORKER_TOKEN must be set on Render.
WORKER_TOKEN=
TMDB_API_KEY=
API_BASE_URL=https://wrapped-backend.onrender.com
SCRAPE_TRANSPORT=stealth_browser
CAMOUFOX_RESTART_EVERY=8
CAMOUFOX_PROFILE_DIR=/REPLACE_HOME/.local/share/movieswrapped/camoufox-profile
EOF
  sed -i "s|/REPLACE_HOME|$HOME|g" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE — fill WORKER_TOKEN and TMDB_API_KEY if they are empty."
else
  echo "Keeping existing $ENV_FILE"
  grep -q '^API_BASE_URL=' "$ENV_FILE" || echo 'API_BASE_URL=https://wrapped-backend.onrender.com' >> "$ENV_FILE"
  grep -q '^SCRAPE_TRANSPORT=' "$ENV_FILE" || echo 'SCRAPE_TRANSPORT=stealth_browser' >> "$ENV_FILE"
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Movies Wrapped Camoufox scrape worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$BACKEND
Environment=PYTHONPATH=$BACKEND
Environment=SCRAPE_TRANSPORT=stealth_browser
EnvironmentFile=%h/.config/movieswrapped/worker.env
ExecStart=$VENV/bin/python -m app.worker.camoufox_worker
Restart=on-failure
RestartSec=10
# One browser. Memory ceiling is the process; systemd restarts if it blows up.
MemoryMax=2G

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable movieswrapped-worker.service

echo
echo "Installed $UNIT"
echo "Start:        systemctl --user start movieswrapped-worker.service"
echo "Status:       systemctl --user status movieswrapped-worker.service"
echo "Logs:         journalctl --user -u movieswrapped-worker.service -f"
echo "Linger (boot): loginctl enable-linger \$USER"
echo
echo "Render dashboard env (same token as $ENV_FILE):"
echo "  WORKER_TOKEN=<the value in worker.env>"
echo "Do not set SCRAPE_TRANSPORT on Render. Render only queues jobs."
