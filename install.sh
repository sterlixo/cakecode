#!/usr/bin/env bash
# cakecode one-shot installer. macOS.
#   curl -fsSL https://raw.githubusercontent.com/sterlixo/cakecode/main/install.sh | bash
set -euo pipefail

CONF="$HOME/.config/cakecode"
ROOT="$HOME/.local/share/cakecode"
BIN="$HOME/.local/bin"
OPENCODE_BIN="$HOME/.opencode/bin/opencode"

RAW="https://raw.githubusercontent.com/sterlixo/cakecode/main"

mkdir -p "$CONF/agents" "$ROOT" "$BIN"

fetch() {
  curl -fsSL "$RAW/$1" -o "$2"
}

fetch agents/cakecode.md     "$CONF/agents/cakecode.md"
fetch opencode.jsonc         "$CONF/opencode.jsonc"
fetch service.json           "$CONF/service.json"
fetch theme.json             "$CONF/theme.json"
fetch ui.mjs                 "$CONF/ui.mjs"
fetch bin/cakecode           "$BIN/cakecode"
fetch bin/cakecode-ui        "$BIN/cakecode-ui"

chmod +x "$BIN/cakecode" "$BIN/cakecode-ui"

if [ ! -x "$OPENCODE_BIN" ]; then
  echo "OpenCode not found — installing via npm…" >&2
  npm install -g @opencode/ai 2>/dev/null || true
fi

if [ ! -x "$OPENCODE_BIN" ]; then
  echo "warning: OpenCode still not found at $OPENCODE_BIN" >&2
  echo "install OpenCode first, then run: cakecode" >&2
else
  echo "installed. run: cakecode   (or cakecode-ui for the themed browser UI)"
fi
