#!/usr/bin/env bash
# Starts the API server + web app (npm run dev) and opens the web app in a
# browser once it responds. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="http://127.0.0.1:5173"

npm run dev &
dev_pid=$!
trap 'kill "$dev_pid" 2>/dev/null || true' EXIT

for _ in $(seq 1 120); do
  if curl -sf -o /dev/null "$URL"; then
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$URL" >/dev/null 2>&1 &
    elif command -v open >/dev/null 2>&1; then
      open "$URL"
    else
      echo "Open $URL in a browser."
    fi
    break
  fi
  sleep 0.5
done

wait "$dev_pid"
