#!/bin/bash
# PreToolUse (matcher: Bash) hook: git commit / gh pr create の直前に
# PROGRESS.md の更新を強制する (主役フック)。
# opt-in: リポジトリルートに PROGRESS.md が存在する時だけ動く。
#
# Grok では PostToolUse は block できないので、commit 後ではなく直前に deny する。
#
# 動作:
#   1. toolInput.command に "git commit" / "gh pr create" が含まれなければ exit 0
#   2. ログの ### エントリが 10 件を超えていたら古い方 (下側) から機械的にトリム
#      (mtime は保存する — トリムで更新要求ガードを潰さないため)
#   3. PROGRESS.md の mtime が直近 5 分以内なら exit 0 (更新済みとみなす)
#   4. それ以外は deny: 先に『現在地』上書き + ログ追記してから再実行させる
#
# 誤発火 (echo 内の "git commit" 等) は許容 — 実害は余計な更新要求 1 回。

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || exit 0

ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
PROGRESS="$ROOT/PROGRESS.md"
[ -f "$PROGRESS" ] || exit 0

CMD=$(printf '%s' "$INPUT" | jq -r '.toolInput.command // .tool_input.command // empty' 2>/dev/null)
[ -n "$CMD" ] || exit 0
printf '%s' "$CMD" | grep -qE 'git commit|gh pr create' || exit 0

file_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}

# --- ログのトリム (### エントリ 10 件超は古い方から削除、mtime 保存) ---
ENTRY_COUNT=$(grep -c '^### ' "$PROGRESS" 2>/dev/null || true)
if [ "${ENTRY_COUNT:-0}" -gt 10 ]; then
  TMP=$(mktemp)
  cp -p "$PROGRESS" "$TMP"
  awk '
    /^## / { inlog = ($0 ~ /^## ログ/) ? 1 : 0; n = 0; print; next }
    inlog && /^### / { n++ }
    inlog && n > 10 { next }
    { print }
  ' "$TMP" > "$PROGRESS"
  touch -r "$TMP" "$PROGRESS"
  rm -f "$TMP"
fi

# --- 二重要求防止: mtime が直近 5 分以内なら更新済みとみなす ---
NOW=$(date +%s)
MTIME=$(file_mtime "$PROGRESS")
if [ -n "$MTIME" ] && [ $((NOW - MTIME)) -lt 300 ]; then
  exit 0
fi

REASON="コミット/PR作成の前に ${PROGRESS} の『現在地』セクションを上書きし、『ログ』に 3〜5 行 (plan差分 / 失敗したアプローチ / ハマりどころ) を追記してから再実行すること。git log や issue で分かる情報 (何を変更したか等) は書かないこと。"

jq -n --arg r "$REASON" '{
  decision: "deny",
  reason: $r
}'
exit 0
