#!/bin/bash
# SessionStart hook.
# Grok は SessionStart の stdout を無視する (公式 docs)。注入は skill 側が
# PROGRESS.md を読む前提。ここは opt-in 確認と、将来 additionalContext が
# 効くようになったとき用の JSON を出すだけ。
# opt-in: リポジトリルートに PROGRESS.md が存在する時だけ動く。

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || exit 0

ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
PROGRESS="$ROOT/PROGRESS.md"
[ -f "$PROGRESS" ] || exit 0
[ -s "$PROGRESS" ] || exit 0

# 「### 」エントリの 4 件目以降は含めない
SNIPPET=$(awk 'BEGIN { n = 0 } /^### / { n++; if (n > 3) exit } { print }' "$PROGRESS")
[ -n "$SNIPPET" ] || exit 0

REASON="[workflow-grok] ${PROGRESS} の内容 (現在地 + 直近ログ)。作業再開時はまず『次の一手』と整合する初手を打つこと:

${SNIPPET}"

# ドキュメント上 SessionStart の stdout は無視される。効けば注入、効かなくても害はない。
jq -n --arg r "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $r
  }
}'

exit 0
