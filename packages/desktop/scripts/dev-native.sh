#!/usr/bin/env bash
set -euo pipefail

renderer_url="${EDITORTS_DESKTOP_URL:-http://localhost:2050}"
max_attempts="${EDITORTS_DESKTOP_WAIT_ATTEMPTS:-120}"
sleep_seconds="${EDITORTS_DESKTOP_WAIT_INTERVAL:-0.25}"

bun run dev &
vite_pid=$!

cleanup() {
  kill "$vite_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

attempt=0
while [ "$attempt" -lt "$max_attempts" ]; do
  if bun --eval "const url = process.argv[1]; try { const response = await fetch(url); process.exit(response.ok ? 0 : 1); } catch { process.exit(1); }" "$renderer_url" >/dev/null 2>&1; then
    break
  fi

  attempt=$((attempt + 1))
  sleep "$sleep_seconds"
done

if [ "$attempt" -ge "$max_attempts" ]; then
  echo "Timed out waiting for desktop renderer at $renderer_url" >&2
  exit 1
fi

EDITORTS_ELECTROBUN_SKIP_PREBUILD=1 EDITORTS_DESKTOP_RPC_DEBUG=1 EDITORTS_AI_DEBUG=1 EDITORTS_DESKTOP_URL="$renderer_url" bun x electrobun dev
