#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-2022}"
AI_PORT="${AI_PORT:-4096}"
APP_HOST="${APP_HOST:-127.0.0.1}"

cleanup() {
  if [[ -n "${AI_PID:-}" ]]; then
    kill "${AI_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

cd "${ROOT_DIR}"

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode CLI not found on PATH" >&2
  exit 1
fi

echo "Starting OpenCode on http://127.0.0.1:${AI_PORT}"
opencode serve --port "${AI_PORT}" --cors "http://localhost:${APP_PORT}" --cors "http://127.0.0.1:${APP_PORT}" &
AI_PID=$!

echo "Starting Solid dev server on http://${APP_HOST}:${APP_PORT}"
exec bun run dev --host "${APP_HOST}" --port "${APP_PORT}"
