#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ "${EDITORTS_DESKTOP_SKIP_BUILD:-0}" != "1" ]]; then
  echo "[editorts-desktop] building stable desktop package..."
  cd "${PACKAGE_DIR}"
  bun run build:stable
fi

ARCHIVE_PATH="$(find "${PACKAGE_DIR}/artifacts" -maxdepth 1 -type f -name '*-Setup.tar.gz' | sort | tail -n 1)"

if [[ -z "${ARCHIVE_PATH}" ]]; then
  echo "[editorts-desktop] no Linux installer archive found in ${PACKAGE_DIR}/artifacts" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/editorts-desktop-installer.XXXXXX")"
cleanup() {
  rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

echo "[editorts-desktop] extracting installer archive:"
echo "  ${ARCHIVE_PATH}"
tar -xzf "${ARCHIVE_PATH}" -C "${TEMP_DIR}"

INSTALLER_PATH="${TEMP_DIR}/installer"
if [[ ! -x "${INSTALLER_PATH}" ]]; then
  echo "[editorts-desktop] extracted installer not found: ${INSTALLER_PATH}" >&2
  exit 1
fi

echo "[editorts-desktop] running local installer..."
"${INSTALLER_PATH}"
