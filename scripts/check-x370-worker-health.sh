#!/usr/bin/env bash
# Health check for the X370 systemd --user scrape worker.
# Prints unit state only. Never dumps the env file or tokens.
set -euo pipefail

UNIT="${WORKER_SYSTEMD_UNIT:-movieswrapped-worker.service}"
fail=0

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found" >&2
  exit 1
fi

active="$(systemctl --user is-active "$UNIT" 2>/dev/null || true)"
enabled="$(systemctl --user is-enabled "$UNIT" 2>/dev/null || true)"
echo "unit=$UNIT"
echo "active=$active"
echo "enabled=$enabled"

if [[ "$active" != "active" ]]; then
  echo "health=fail reason=inactive" >&2
  fail=1
fi

if command -v loginctl >/dev/null 2>&1; then
  linger="$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)"
  echo "linger=$linger"
  if [[ "$linger" != "yes" ]]; then
    echo "health=warn reason=linger-disabled (worker will not start on boot)" >&2
  fi
fi

# Restart policy is baked into the unit file — surface it without dumping env.
restart="$(systemctl --user show "$UNIT" -p Restart --value 2>/dev/null || echo unknown)"
echo "restart=$restart"
if [[ "$restart" != "always" ]]; then
  echo "health=warn reason=restart-not-always" >&2
fi

if [[ "$fail" -ne 0 ]]; then
  echo "health=fail"
  exit 1
fi
echo "health=ok"
exit 0
