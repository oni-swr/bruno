#!/usr/bin/env bash
# Linux/macOS launcher: starts the speech service (unless one is already running), then the bot.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo 'Copy .env.example to .env and configure your bot token first.' >&2; exit 1; }
# Export .env for the speech service (tolerates CRLF line endings from Windows).
while IFS='=' read -r key value || [ -n "$key" ]; do
  if [[ $key =~ ^[A-Z_]+$ ]]; then export "$key=${value%$'\r'}"; fi
done < .env

health() { curl -fsS --max-time 2 http://127.0.0.1:8765/health 2>/dev/null || true; }
service_ok() { grep -q '"service":"local-discord-mate-speech"' <<<"$1"; }
ready_ok() { service_ok "$1" && grep -q '"ready":true' <<<"$1"; }

speech_pid=
cleanup() { [ -n "$speech_pid" ] && kill "$speech_pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM

response=$(health)
if [ -n "$response" ] && ! service_ok "$response"; then
  echo 'Port 8765 is occupied by another or older service. Stop that service first.' >&2; exit 1
fi
if ! ready_ok "$response"; then
  mkdir -p logs
  .venv/bin/python speech/server.py >>logs/speech.log 2>&1 &
  speech_pid=$!
  for _ in $(seq 120); do
    kill -0 "$speech_pid" 2>/dev/null || { echo 'Speech worker exited. See logs/speech.log or run .venv/bin/python speech/server.py to diagnose.' >&2; exit 1; }
    ready_ok "$(health)" && break
    sleep 1
  done
  ready_ok "$(health)" || { echo 'Speech worker did not become ready.' >&2; exit 1; }
fi
node --env-file=.env src/bot.js
