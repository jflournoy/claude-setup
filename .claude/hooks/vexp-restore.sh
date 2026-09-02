#!/bin/bash
# vexp-restore: context lifecycle restore on SessionStart (compact/resume). Fails open.
VEXP_BIN="/home/jflournoy/.vscode/extensions/vexp.vexp-vscode-3.1.0-linux-x64/binaries/vexp-core-linux-x64/vexp-core"
[ -x "$VEXP_BIN" ] || exit 0
"$VEXP_BIN" session-context 2>/dev/null
exit 0
