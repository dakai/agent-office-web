#!/bin/sh
# Installs Agent Office as a systemd user service, so it is always up at
# http://localhost:7317 (and http://<tailnet-ip>:7317) after install.
#
#   ./install.sh            install and start
#   ./install.sh --uninstall  stop, disable and remove it
#   PORT=8000 ./install.sh  another port (rewrites the unit)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
unit="$HOME/.config/systemd/user/agent-office.service"

if [ "${1:-}" = "--uninstall" ]; then
  systemctl --user disable --now agent-office.service 2>/dev/null || true
  rm -f "$unit"
  systemctl --user daemon-reload
  echo "agent-office removed"
  exit 0
fi

node=$(command -v node) || { echo "node not found in PATH" >&2; exit 1; }
port=${PORT:-7317}

mkdir -p "$(dirname "$unit")"
cat > "$unit" <<EOF
[Unit]
Description=Agent Office: live view of the local coding agents
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$here
ExecStart=$node $here/server.mjs
Environment=PORT=$port
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now agent-office.service
# keep the service up while nobody is logged in (asks for nothing on most desktops)
loginctl enable-linger "$USER" 2>/dev/null || echo "note: run 'sudo loginctl enable-linger $USER' to keep it up while logged out"
sleep 1
systemctl --user --no-pager --lines=0 status agent-office.service | head -3

ip=$(/usr/bin/tailscale ip -4 2>/dev/null | head -1 || true)
echo "office: http://localhost:$port${ip:+  http://$ip:$port}"
