#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${APP_PORT:-5180}"
AI_PORT="${AI_PORT:-4100}"
SESSION="editorts-solid-smoke-${APP_PORT}"
APP_URL="http://127.0.0.1:${APP_PORT}"
AI_URL="http://127.0.0.1:${AI_PORT}"
APP_LOG="/tmp/editorts-solid-smoke-app-${APP_PORT}.log"
AI_LOG="/tmp/editorts-solid-smoke-ai-${AI_PORT}.log"

cleanup() {
  if [[ -n "${APP_PID:-}" ]]; then
    kill "${APP_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${AI_PID:-}" ]]; then
    kill "${AI_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

cd "${ROOT_DIR}"

opencode serve --port "${AI_PORT}" --cors "${APP_URL}" --cors "http://localhost:${APP_PORT}" >"${AI_LOG}" 2>&1 &
AI_PID=$!

bun run dev --host 127.0.0.1 --port "${APP_PORT}" >"${APP_LOG}" 2>&1 &
APP_PID=$!

python - <<PY
import time, urllib.request

targets = [
    ("${APP_URL}", 30),
    (f"${AI_URL}/config", 30),
]

for url, attempts in targets:
    for index in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                if response.status < 500:
                    break
        except Exception:
            if index == attempts - 1:
                raise
            time.sleep(1)
PY

agent-browser --session "${SESSION}" open "${APP_URL}" >/dev/null
agent-browser --session "${SESSION}" snapshot -i >/dev/null
agent-browser --session "${SESSION}" wait --fn "Boolean(window.editor && window.editor.ai)" >/dev/null

agent-browser --session "${SESSION}" eval "(async () => { const client = await window.editor.ai.getClient(); const result = await client.config.get(); return JSON.stringify({ ok: Boolean(result.data), baseUrl: window.editor.ai.getUrl() }); })()"

agent-browser --session "${SESSION}" find text "Use Remote Workspace" click >/dev/null
agent-browser --session "${SESSION}" wait 1500 >/dev/null
agent-browser --session "${SESSION}" eval "(async () => { const files = await window.editor.content.adapter.listFiles(); return JSON.stringify(files.map((file) => file.path)); })()"

agent-browser --session "${SESSION}" eval "(() => { const files = new Map([['index.html', '<!DOCTYPE html><html><head><title>Mock Folder</title></head><body><main id=\"app-root\"><h1 id=\"title\">Folder mode headline</h1><p id=\"body\">Mock folder content.</p></main></body></html>'], ['styles.css', 'body { margin: 0; } #title { color: rgb(17, 24, 39); }']]); const makeFileHandle = (path) => ({ kind: 'file', async getFile() { return new File([files.get(path) || ''], path.split('/').pop() || path, { type: 'text/plain' }); }, async createWritable() { return { async write(data) { files.set(path, typeof data === 'string' ? data : String(data)); }, async close() {} }; } }); const makeDirectoryHandle = (prefix, name) => ({ kind: 'directory', name, async *entries() { const seen = new Set(); for (const path of files.keys()) { if (prefix && !path.startsWith(prefix + '/')) continue; const rest = prefix ? path.slice(prefix.length + 1) : path; if (!rest) continue; const slash = rest.indexOf('/'); if (slash === -1) { if (!seen.has(rest)) { seen.add(rest); yield [rest, makeFileHandle(prefix ? prefix + '/' + rest : rest)]; } continue; } const dir = rest.slice(0, slash); if (!seen.has(dir)) { seen.add(dir); const nextPrefix = prefix ? prefix + '/' + dir : dir; yield [dir, makeDirectoryHandle(nextPrefix, dir)]; } } }, async getDirectoryHandle(child) { const nextPrefix = prefix ? prefix + '/' + child : child; return makeDirectoryHandle(nextPrefix, child); }, async getFileHandle(child, options) { const nextPath = prefix ? prefix + '/' + child : child; if (!files.has(nextPath) && !(options && options.create)) { throw new Error('missing file'); } if (!files.has(nextPath)) files.set(nextPath, ''); return makeFileHandle(nextPath); } }); window.showDirectoryPicker = async () => makeDirectoryHandle('', 'mock-project'); return 'ok'; })()" >/dev/null
agent-browser --session "${SESSION}" find text "Connect Folder" click >/dev/null
agent-browser --session "${SESSION}" wait 1500 >/dev/null
agent-browser --session "${SESSION}" click @e23 >/dev/null 2>&1 || true
agent-browser --session "${SESSION}" snapshot -i >/dev/null
agent-browser --session "${SESSION}" eval "(async () => { const files = await window.editor.content.adapter.listFiles(); return JSON.stringify(files.map((file) => file.path)); })()"

agent-browser --session "${SESSION}" find text "Use Demo Workspace" click >/dev/null
agent-browser --session "${SESSION}" wait 1500 >/dev/null
agent-browser --session "${SESSION}" eval "(async () => { const client = await window.editor.ai.getClient(); const session = await client.session.create({ body: { title: 'smoke prompt' } }); const result = await client.session.prompt({ path: { id: session.data.id }, body: { model: { providerID: 'opencode', modelID: 'gemini-3.1-pro' }, tools: { '*': false }, parts: [{ type: 'text', text: 'Return JSON only: {\"ok\":true}' }] } }); const text = (result.data?.parts || []).map((part) => part.type === 'text' ? part.text : '').join(''); return JSON.stringify({ text }); })()"

agent-browser --session "${SESSION}" eval "(async () => { const data = JSON.parse(window.editor.save()); const components = JSON.parse(data.pages[0].body.components); components[0].components[0].content = 'Smoke script apply passed'; data.pages[0].body.components = JSON.stringify(components); await window.editor.ai.apply([{ path: 'page.json', content: JSON.stringify(data, null, 2) }]); return JSON.stringify({ headline: window.editor.page.components.findById('solid-headline')?.content || null }); })()"

printf 'Smoke completed successfully\n'
