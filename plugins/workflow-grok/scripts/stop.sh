#!/bin/bash
# Stop hook: バックストップ。PreToolUse をすり抜けた場合の保険。
# opt-in: リポジトリルートに PROGRESS.md が存在する時だけ動く。
#
# 動作:
#   1. reason が end_turn でなければ exit 0 (セッション終了の observe fire を無視)
#   2. stopHookActive が true なら即 exit 0 (無限ループ防止・最重要)
#   3. HEAD のコミット時刻が PROGRESS.md の mtime より 300 秒超新しければ block
#      (更新してから commit すると HEAD が数秒新しいので、猶予が必要)
#   4. それ以外は exit 0

set -u

command -v jq >/dev/null 2>&1 || exit 0

INPUT=$(cat)

REASON=$(printf '%s' "$INPUT" | jq -r '.reason // empty' 2>/dev/null)
[ -z "$REASON" ] || [ "$REASON" = "end_turn" ] || exit 0

# 無限ループ防止ガード — reason の次に評価する
ACTIVE=$(printf '%s' "$INPUT" | jq -r '.stopHookActive // .stop_hook_active // false' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$CWD" ] || exit 0

ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
PROGRESS="$ROOT/PROGRESS.md"
[ -f "$PROGRESS" ] || exit 0

HEAD_TS=$(git -C "$ROOT" log -1 --format=%ct 2>/dev/null)
[ -n "$HEAD_TS" ] || exit 0

file_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null
}
MTIME=$(file_mtime "$PROGRESS")
[ -n "$MTIME" ] || exit 0

if [ $((HEAD_TS - MTIME)) -gt 300 ]; then
  MSG="HEAD のコミットが ${PROGRESS} より 5 分以上新しい。『現在地』の上書きと『ログ』への追記 (plan差分 / 失敗 / ハマり、3〜5 行) を済ませてから終了すること。"
  jq -n --arg r "$MSG" '{ decision: "block", reason: $r }'
  exit 0
fi

exit 0
