#!/bin/bash
# pre-commit から呼ぶ check-versions.sh のラッパー。
# - 対象ファイル (marketplace.json / plugins/*/plugin.json) が
#   ステージの変更 (削除・対象外への移動を含む) か、pre-commit から渡されたファイル
#   (--all-files 時は全追跡ファイル) に無ければ何もしない。pre-commit の files: は
#   削除を拾わないので、判定はここで行う (always_run: true で呼ばれる前提)
# - 検査はステージ内容 (index) を展開した一時ディレクトリで行う。作業ツリーの
#   untracked ファイルが結果に混ざらないようにするため

set -u

TARGET='^(\.grok-plugin/marketplace\.json|plugins/[^/]+/plugin\.json)$'

# --no-renames: 移動を「削除 + 追加」として出し、移動元のパスも判定に含める
staged=$(git diff --cached --no-renames --name-only) \
  || { echo "git diff --cached が失敗した" >&2; exit 2; }

if ! printf '%s\n' "$staged" "$@" | grep -qE "$TARGET"; then
  exit 0
fi

snapshot=$(mktemp -d) || exit 2
trap 'rm -rf "$snapshot"' EXIT

git checkout-index -a --prefix="$snapshot/" || exit 2
bash "$snapshot/scripts/check-versions.sh" --quiet
