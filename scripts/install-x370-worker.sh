#!/usr/bin/env bash
# Install the Movies Wrapped Safari scrape worker as a systemd --user service.
# X370 has Python 3.14 and no 3.12/uv — do not use uv.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$REPO_ROOT/backend"
VENV="${MOVIESWRAPPED_VENV:-$HOME/.local/share/movieswrapped/venv}"
ENV_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/movieswrapped/worker.env"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/movieswrapped-worker.service"
PYTHON="${PYTHON:-python3}"

if [[ "$PYTHON" == "python3" ]] && command -v python3.14 >/dev/null 2>&1; then
  PYTHON=python3.14
fi

if [[ ! -d "$BACKEND" ]]; then
  echo "Cannot find backend/ under $REPO_ROOT" >&2
  exit 1
fi

if ! "$PYTHON" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 14) else 1)'; then
  echo "X370 worker needs Python 3.14+ (this box has no 3.12/uv). Found: $($PYTHON -V)" >&2
  exit 1
fi

mkdir -p "$(dirname "$ENV_FILE")" "$UNIT_DIR" "$(dirname "$VENV")"

echo "Creating venv at $VENV with $PYTHON ($($PYTHON -V))"
"$PYTHON" -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND/requirements.txt"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<'EOF'
# Same WORKER_TOKEN must be set on Render.
WORKER_TOKEN=
TMDB_API_KEY=
API_BASE_URL=https://wrapped-backend.onrender.com
EOF
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE — fill WORKER_TOKEN and TMDB_API_KEY if they are empty."
else
  echo "Keeping existing $ENV_FILE"
  grep -q '^API_BASE_URL=' "$ENV_FILE" || echo 'API_BASE_URL=https://wrapped-backend.onrender.com' >> "$ENV_FILE"
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Movies Wrapped Safari scrape worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$BACKEND
Environment=PYTHONPATH=$BACKEND
EnvironmentFile=%h/.config/movieswrapped/worker.env
ExecStart=$VENV/bin/python -m app.worker.safari_worker
Restart=always
RestartSec=10
MemoryMax=2G

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable movieswrapped-worker.service
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" >/dev/null 2>&1 || echo "Could not enable linger automatically — run: loginctl enable-linger $USER"
fi
systemctl --user start movieswrapped-worker.service || true

echo
echo "Installed $UNIT (Restart=always, linger enabled when possible)"
echo "Start:        systemctl --user start movieswrapped-worker.service"
echo "Status:       systemctl --user status movieswrapped-worker.service"
echo "Health:       $REPO_ROOT/scripts/check-x370-worker-health.sh"
echo "Logs:         journalctl --user -u movieswrapped-worker.service -f"
echo
echo "Render dashboard env (same token as $ENV_FILE):"
echo "  WORKER_TOKEN=<the value in worker.env>"
echo "Do not set SCRAPE_TRANSPORT on Render. Render only queues jobs."
echo "Do not print worker.env — it contains secrets."
