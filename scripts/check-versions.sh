#!/bin/bash
# plugins/<name>/plugin.json と .grok-plugin/marketplace.json の
# version が全プラグインで一致しているかを検査する。
#   exit 0: 全一致 / exit 1: 不一致・片側欠落あり / exit 2: 実行環境の問題 (jq 無し等)・引数誤り
#   --quiet: OK 行と対象外 (--) 行を出さない。NG 行とエラーは常に stderr に出す
#   (--quiet は stdout ごと捨てる実装。抑止してよい情報行以外は必ず >&2 で出すこと)
#   -h, --help: 使い方を stdout に出して exit 0 (検査はしない)

set -u

usage() {
  cat <<EOF
usage: $(basename "$0") [--quiet] [-h|--help]

plugin.json と marketplace.json の version が全プラグインで一致しているかを検査する。

options:
  --quiet     OK 行と対象外 (--) 行を出さない (NG 行とエラーは常に stderr)
  -h, --help  この使い方を表示して終了する

exit status:
  0  全プラグインで一致
  1  不一致・片側欠落あり
  2  実行環境の問題 (jq 無し等)・引数誤り
EOF
}

quiet=0
help=0
for arg in "$@"; do
  case $arg in
    --quiet) quiet=1 ;;
    -h|--help) help=1 ;;
    *) usage >&2; exit 2 ;;
  esac
done

# --help は --quiet より先に処理する (使い方を stdout ごと捨てないため)
if [ "$help" -eq 1 ]; then
  usage
  exit 0
fi

# stdout に出るのは OK / -- 行だけ (NG とエラーは stderr) なので、stdout ごと捨てる
[ "$quiet" -eq 1 ] && exec >/dev/null

command -v jq >/dev/null 2>&1 || { echo "jq が見つからない (brew install jq)" >&2; exit 2; }

ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
MARKETPLACE="$ROOT/.grok-plugin/marketplace.json"
[ -f "$MARKETPLACE" ] || { echo "marketplace.json が無い: $MARKETPLACE" >&2; exit 2; }

# 区切りは IFS 空白でない \x1f (タブだと read が空フィールドを潰して列がずれる)。
# source が文字列でないエントリ (github 等の外部 source) は type 列で見分ける。
SEP=$'\x1f'
ENTRIES=$(jq -r '
  if (.plugins | type) != "array" then error(".plugins が配列ではない") else . end
  | .plugins[]
  | [ (.name // "" | tostring),
      (.source | if type == "string" then "local" elif type == "null" then "none" else "external" end),
      (.source | if type == "string" then . else "" end),
      (.version // "" | tostring) ]
  | join("\u001f")' "$MARKETPLACE") \
  || { echo "marketplace.json を解釈できない: $MARKETPLACE" >&2; exit 2; }

status=0
listed=""

while IFS="$SEP" read -r name kind source mversion; do
  [ -n "$name$kind$source$mversion" ] || continue
  rel=${source#./}
  rel=${rel%/}
  # 掲載済みディレクトリは name の有無に関係なく記録する (未掲載チェックでの二重報告を防ぐ)
  [ "$kind" = "local" ] && [ -n "$rel" ] && listed="$listed $rel"
  if [ -z "$name" ]; then
    echo "NG  (name なし): marketplace.json のエントリに name が無い (source=${source:-<なし>})" >&2
    status=1
    continue
  fi
  if [ "$kind" = "external" ]; then
    echo "--  $name: ローカル以外の source なので対象外"
    continue
  fi
  if [ "$kind" = "none" ] || [ -z "$source" ]; then
    echo "NG  $name: marketplace.json のエントリに source が無い" >&2
    status=1
    continue
  fi
  manifest="$ROOT/$rel/plugin.json"
  if [ ! -f "$manifest" ]; then
    echo "NG  $name: marketplace.json にあるが plugin.json が無い ($rel/plugin.json)" >&2
    status=1
    continue
  fi
  pversion=$(jq -r '.version // "" | tostring' "$manifest") \
    || { echo "NG  $name: plugin.json を JSON として読めない ($rel/plugin.json)" >&2; status=1; continue; }
  if [ -z "$mversion" ] || [ "$mversion" != "$pversion" ]; then
    echo "NG  $name: marketplace.json=${mversion:-<なし>} plugin.json=${pversion:-<なし>}" >&2
    status=1
  else
    echo "OK  $name $pversion"
  fi
done <<< "$ENTRIES"

# plugins/ にあるのに marketplace.json に載っていないプラグイン
for manifest in "$ROOT"/plugins/*/plugin.json; do
  [ -f "$manifest" ] || continue
  dir=${manifest#"$ROOT"/plugins/}
  dir=${dir%%/*}
  case " $listed " in
    *" plugins/$dir "*) ;;
    *) echo "NG  $dir: plugins/$dir/plugin.json があるが marketplace.json に無い" >&2; status=1 ;;
  esac
done

exit $status
