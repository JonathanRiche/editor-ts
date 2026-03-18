#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALLED_APP_DIR="${HOME}/.local/share/com.blink.desktop/stable/app"

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

VERSION_JSON_PATH="${INSTALLED_APP_DIR}/Resources/version.json"
if [[ -f "${VERSION_JSON_PATH}" ]]; then
  APP_NAME="$(bun -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(version.name || "Blink");' "${VERSION_JSON_PATH}")"
  APP_IDENTIFIER="$(bun -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(version.identifier || "com.blink.desktop");' "${VERSION_JSON_PATH}")"
else
  APP_NAME="Blink"
  APP_IDENTIFIER="com.blink.desktop"
fi

APP_EXEC_PATH="${INSTALLED_APP_DIR}/bin/${APP_NAME}"
ln -sf "${INSTALLED_APP_DIR}/bin/launcher" "${APP_EXEC_PATH}"
echo "[editorts-desktop] app executable alias:"
echo "  ${APP_EXEC_PATH}"

DESKTOP_ENTRY_DIR="${HOME}/.local/share/applications"
DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${APP_NAME}.desktop"
LEGACY_DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${APP_IDENTIFIER}.desktop"
ICON_PATH="${INSTALLED_APP_DIR}/Resources/appIcon.png"
mkdir -p "${DESKTOP_ENTRY_DIR}"

cat > "${DESKTOP_ENTRY_PATH}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Exec=${APP_EXEC_PATH}
Terminal=false
Categories=Development;
StartupNotify=true
EOF

if [[ -f "${ICON_PATH}" ]]; then
  printf 'Icon=%s\n' "${ICON_PATH}" >> "${DESKTOP_ENTRY_PATH}"
fi

chmod 0644 "${DESKTOP_ENTRY_PATH}"

if [[ -f "${LEGACY_DESKTOP_ENTRY_PATH}" && "${LEGACY_DESKTOP_ENTRY_PATH}" != "${DESKTOP_ENTRY_PATH}" ]]; then
  rm -f "${LEGACY_DESKTOP_ENTRY_PATH}"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DESKTOP_ENTRY_DIR}" >/dev/null 2>&1 || true
fi

echo "[editorts-desktop] desktop entry:"
echo "  ${DESKTOP_ENTRY_PATH}"
