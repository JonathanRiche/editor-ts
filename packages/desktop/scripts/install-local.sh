#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALLED_APP_DIR="${HOME}/.local/share/com.verde.desktop/stable/app"
LEGACY_INSTALLED_APP_DIR="${HOME}/.local/share/com.blink.desktop/stable/app"

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
  APP_NAME="$(bun -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(version.name || "Verde");' "${VERSION_JSON_PATH}")"
  APP_IDENTIFIER="$(bun -e 'const fs = require("node:fs"); const version = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(version.identifier || "com.verde.desktop");' "${VERSION_JSON_PATH}")"
else
  APP_NAME="Verde"
  APP_IDENTIFIER="com.verde.desktop"
fi

APP_EXEC_PATH="${INSTALLED_APP_DIR}/bin/${APP_NAME}"
ln -sf "${INSTALLED_APP_DIR}/bin/launcher" "${APP_EXEC_PATH}"
echo "[editorts-desktop] app executable alias:"
echo "  ${APP_EXEC_PATH}"

DESKTOP_ENTRY_DIR="${HOME}/.local/share/applications"
DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${APP_NAME}.desktop"
LEGACY_DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${APP_IDENTIFIER}.desktop"
OLD_APP_NAME="Blink"
OLD_APP_IDENTIFIER="com.blink.desktop"
OLD_DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${OLD_APP_NAME}.desktop"
OLD_IDENTIFIER_DESKTOP_ENTRY_PATH="${DESKTOP_ENTRY_DIR}/${OLD_APP_IDENTIFIER}.desktop"
ICON_PATH="${INSTALLED_APP_DIR}/Resources/appIcon.png"
CLI_ENTRY_DIR="${HOME}/.local/bin"
CLI_ENTRY_NAME="$(printf '%s' "${APP_NAME}" | tr '[:upper:]' '[:lower:]')"
CLI_ENTRY_PATH="${CLI_ENTRY_DIR}/${CLI_ENTRY_NAME}"
OLD_CLI_ENTRY_PATH="${CLI_ENTRY_DIR}/blink"
mkdir -p "${DESKTOP_ENTRY_DIR}"
mkdir -p "${CLI_ENTRY_DIR}"

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
rm -f "${OLD_DESKTOP_ENTRY_PATH}" "${OLD_IDENTIFIER_DESKTOP_ENTRY_PATH}"

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${DESKTOP_ENTRY_DIR}" >/dev/null 2>&1 || true
fi

echo "[editorts-desktop] desktop entry:"
echo "  ${DESKTOP_ENTRY_PATH}"

rm -f "${CLI_ENTRY_PATH}"
rm -f "${OLD_CLI_ENTRY_PATH}"
cat > "${CLI_ENTRY_PATH}" <<EOF
#!/usr/bin/env bash
set -euo pipefail

resolve_project_path() {
  local input="\$1"
  if command -v realpath >/dev/null 2>&1; then
    realpath "\$input"
    return
  fi
  python3 - "\$input" <<'PY'
import os
import sys

print(os.path.realpath(sys.argv[1]))
PY
}

if command -v systemctl >/dev/null 2>&1; then
  while IFS='=' read -r key value; do
    case "\${key}" in
      DISPLAY|WAYLAND_DISPLAY|XDG_SESSION_TYPE|DBUS_SESSION_BUS_ADDRESS)
        if [[ -z "\${!key:-}" && -n "\${value}" ]]; then
          export "\${key}=\${value}"
        fi
        ;;
    esac
  done < <(systemctl --user show-environment 2>/dev/null || true)
fi

project_path=""
forwarded_args=()
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -p|--project)
      if [[ \$# -gt 1 ]]; then
        project_path="\$(resolve_project_path "\$2")"
        shift 2
        continue
      fi
      ;;
    --project=*|-p=*)
      project_path="\$(resolve_project_path "\${1#*=}")"
      shift
      continue
      ;;
  esac

  forwarded_args+=("\$1")
  shift
done

if [[ -n "\${project_path}" ]]; then
  export EDITORTS_DESKTOP_PROJECT_ROOT="\${project_path}"
fi

exec "${APP_EXEC_PATH}" "\${forwarded_args[@]}"
EOF
chmod 0755 "${CLI_ENTRY_PATH}"

echo "[editorts-desktop] cli entry:"
echo "  ${CLI_ENTRY_PATH}"

if [[ -e "${LEGACY_INSTALLED_APP_DIR}" ]]; then
  rm -rf "${LEGACY_INSTALLED_APP_DIR}"
fi
