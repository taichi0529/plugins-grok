#!/usr/bin/env bash
# obsidian-grok — Obsidian vault の設定管理と実行時コンテキスト収集
#
# サブコマンド:
#   check              設定を検証して診断を出す (先頭行に STATUS: ok|unconfigured|invalid)
#   context [--pull]   daily-report skill 用の実行時コンテキストを出す
#                      --pull を付けると、読み取る前に remote/branch から ff-only で最新化する
#   env                eval 可能な KEY=VALUE を出す (設定が妥当なときのみ)
#   write [opts]       検証してから設定ファイルを書く
#   allow-git          ~/.grok/config.toml に repoRoot 限定の git 許可ルールを追記する
#   path               設定ファイルのパスを出す
#
# 設定ファイル: $OBSIDIAN_GROK_CONFIG、無ければ ~/.grok/obsidian-grok.json、
#               それも無ければ読み取りフォールバックで ~/.claude/obsidian-cc.json
# 依存: bash (3.2 でも動く), git, jq
#
# 終了コード: 0 = 正常 / 1 = 設定不備・検証 NG / 2 = 使い方の誤り
# context は常に 0 で終わる。

set -uo pipefail

resolve_config_path() {
  if [ -n "${OBSIDIAN_GROK_CONFIG:-}" ]; then
    printf '%s\n' "$OBSIDIAN_GROK_CONFIG"
    return
  fi
  if [ -f "${HOME}/.grok/obsidian-grok.json" ]; then
    printf '%s\n' "${HOME}/.grok/obsidian-grok.json"
    return
  fi
  if [ -f "${HOME}/.claude/obsidian-cc.json" ]; then
    printf '%s\n' "${HOME}/.claude/obsidian-cc.json"
    return
  fi
  printf '%s\n' "${HOME}/.grok/obsidian-grok.json"
}

CONFIG_PATH=$(resolve_config_path)
GROK_CONFIG_PATH="${OBSIDIAN_GROK_SETTINGS:-${HOME}/.grok/config.toml}"
CLAUDE_SETTINGS_PATH="${HOME}/.claude/settings.json"

REPO_ROOT=""
VAULT_DIR=""
REMOTE=""
BRANCH=""
PROJECT_TAG=""

# bash 3.2 (macOS 標準) でも動くよう、配列ではなく改行区切りの文字列で貯める
PROBLEMS=""
problem() { PROBLEMS="${PROBLEMS}- ${1}
"; }
has_problems() { [ -n "$PROBLEMS" ]; }
print_problems() { printf '%s' "$PROBLEMS"; }

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "STATUS: invalid"
    echo "jq が見つからない。obsidian-grok は jq に依存している (macOS なら brew install jq)。"
    return 1
  fi
  return 0
}

# 末尾スラッシュを落とし、存在するディレクトリなら物理パスに正規化する
normalize_dir() {
  local p="${1:-}"
  case "$p" in
    "~") p="$HOME" ;;
    "~/"*) p="${HOME}/${p#\~/}" ;;
  esac
  while [ "${#p}" -gt 1 ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
  if [ -d "$p" ]; then (cd "$p" 2>/dev/null && pwd -P) || printf '%s\n' "$p"; else printf '%s\n' "$p"; fi
}

# 0 = 読めた / 2 = ファイルが無い / 3 = JSON として壊れている
load_config() {
  [ -f "$CONFIG_PATH" ] || return 2
  jq -e . "$CONFIG_PATH" >/dev/null 2>&1 || return 3
  REPO_ROOT=$(normalize_dir "$(jq -r '.repoRoot // ""' "$CONFIG_PATH")")
  VAULT_DIR=$(normalize_dir "$(jq -r '.vaultDir // ""' "$CONFIG_PATH")")
  REMOTE=$(jq -r '.remote // "origin"' "$CONFIG_PATH")
  BRANCH=$(jq -r '.branch // "main"' "$CONFIG_PATH")
  PROJECT_TAG=$(jq -r '.projectTag // "project"' "$CONFIG_PATH")
  [ -n "$VAULT_DIR" ] || VAULT_DIR="$REPO_ROOT"
  return 0
}

# REPO_ROOT / VAULT_DIR / REMOTE / BRANCH / PROJECT_TAG を検証し PROBLEMS に積む
validate_config() {
  PROBLEMS=""

  if [ -z "$REPO_ROOT" ]; then
    problem "repoRoot が空。Obsidian vault を管理している git リポジトリのルートを絶対パスで指定する"
    return
  fi
  case "$REPO_ROOT" in
    /*) ;;
    *) problem "repoRoot は絶対パスで指定する (今の値: ${REPO_ROOT})"; return ;;
  esac
  if [ ! -d "$REPO_ROOT" ]; then
    problem "repoRoot が存在しない: ${REPO_ROOT}"
    return
  fi

  local toplevel
  toplevel=$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)
  if [ -z "$toplevel" ]; then
    problem "repoRoot が git リポジトリではない: ${REPO_ROOT}"
  elif [ "$(normalize_dir "$toplevel")" != "$REPO_ROOT" ]; then
    problem "repoRoot がリポジトリのルートではない (ルートは ${toplevel})"
  fi

  if [ ! -d "$VAULT_DIR" ]; then
    problem "vaultDir が存在しない: ${VAULT_DIR}"
  else
    # vault は repoRoot 配下でなければならない (外に書くと commit できない)
    case "$VAULT_DIR" in
      "$REPO_ROOT" | "$REPO_ROOT"/*) ;;
      *) problem "vaultDir は repoRoot 配下である必要がある (vaultDir: ${VAULT_DIR} / repoRoot: ${REPO_ROOT})" ;;
    esac
  fi

  if [ -n "$toplevel" ]; then
    if ! git -C "$REPO_ROOT" remote get-url "$REMOTE" >/dev/null 2>&1; then
      problem "remote '${REMOTE}' がリポジトリに無い (git -C ${REPO_ROOT} remote -v で確認)"
    fi
    if ! git -C "$REPO_ROOT" rev-parse --verify --quiet "refs/heads/${BRANCH}" >/dev/null 2>&1; then
      problem "branch '${BRANCH}' がリポジトリに無い"
    fi
  fi

  case "$PROJECT_TAG" in
    *[!A-Za-z0-9_/-]*) problem "projectTag に使えるのは英数字と _ - / のみ (今の値: ${PROJECT_TAG})" ;;
    "") problem "projectTag が空" ;;
  esac
}

cmd_path() {
  printf '%s\n' "$CONFIG_PATH"
}

cmd_check() {
  require_jq || return 1

  local rc
  load_config
  rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "STATUS: unconfigured"
    echo "設定ファイルが無い: ${CONFIG_PATH}"
    echo "/obsidian-grok:setup を実行して作成する。"
    return 1
  fi
  if [ "$rc" -eq 3 ]; then
    echo "STATUS: invalid"
    echo "設定ファイルが JSON として壊れている: ${CONFIG_PATH}"
    return 1
  fi

  validate_config
  if has_problems; then
    echo "STATUS: invalid"
    echo "config: ${CONFIG_PATH}"
    echo "問題:"
    print_problems
    echo "/obsidian-grok:setup で作り直す。"
    return 1
  fi

  echo "STATUS: ok"
  echo "config: ${CONFIG_PATH}"
  echo "repoRoot: ${REPO_ROOT}"
  echo "vaultDir: ${VAULT_DIR}"
  echo "remote: ${REMOTE}"
  echo "branch: ${BRANCH}"
  echo "projectTag: ${PROJECT_TAG}"
  echo "gitAllowRule: Bash(git -C ${REPO_ROOT} *)"
  return 0
}

cmd_env() {
  require_jq >/dev/null 2>&1 || return 1
  load_config || return 1
  validate_config
  has_problems && return 1
  printf 'OBSIDIAN_GROK_REPO_ROOT=%q\n' "$REPO_ROOT"
  printf 'OBSIDIAN_GROK_VAULT_DIR=%q\n' "$VAULT_DIR"
  printf 'OBSIDIAN_GROK_REMOTE=%q\n' "$REMOTE"
  printf 'OBSIDIAN_GROK_BRANCH=%q\n' "$BRANCH"
  printf 'OBSIDIAN_GROK_PROJECT_TAG=%q\n' "$PROJECT_TAG"
  return 0
}

# frontmatter の tags に projectTag を持つノートの basename を列挙する
list_project_notes() {
  local tag="$1" dir="$2" f base
  for f in "$dir"/*.md; do
    [ -f "$f" ] || continue
    if awk -v tag="$tag" '
      NR == 1 && $0 != "---" { exit 1 }
      NR > 1 && $0 == "---" { exit 1 }
      NR > 1 && $0 ~ "^[[:space:]]*-[[:space:]]*\"?" tag "\"?[[:space:]]*$" { found = 1; exit 0 }
      NR > 1 && $0 ~ "^tags:.*[][ ,\"]" tag "([],\"]|$)" { found = 1; exit 0 }
      END { if (found != 1) exit 1 }
    ' "$f" 2>/dev/null; then
      base=$(basename "$f" .md)
      printf '%s\n' "$base"
    fi
  done
}

# remote/branch から fast-forward で最新化する。結果を 1 行で出力する。
# 履歴を書き換えないよう ff-only に限定し、失敗しても中断しない (理由を出して続行)。
do_pull() {
  local cur before after behind ahead reason
  cur=$(git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null)
  if [ -z "$cur" ]; then
    echo "pull: skipped (detached HEAD)"
    return
  fi
  if [ "$cur" != "$BRANCH" ]; then
    echo "pull: skipped (現在のブランチ ${cur} が設定の ${BRANCH} と異なる)"
    return
  fi
  if ! git -C "$REPO_ROOT" fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null; then
    echo "pull: failed (${REMOTE}/${BRANCH} を fetch できない。ネットワークか認証を確認)"
    return
  fi

  before=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null)
  if git -C "$REPO_ROOT" merge --ff-only FETCH_HEAD >/dev/null 2>&1; then
    after=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null)
    if [ "$before" = "$after" ]; then
      echo "pull: up-to-date (${after})"
    else
      echo "pull: fast-forwarded ${before}..${after}"
    fi
    return
  fi

  behind=$(git -C "$REPO_ROOT" rev-list --count HEAD..FETCH_HEAD 2>/dev/null || echo 0)
  ahead=$(git -C "$REPO_ROOT" rev-list --count FETCH_HEAD..HEAD 2>/dev/null || echo 0)
  if [ "${ahead:-0}" -gt 0 ] && [ "${behind:-0}" -gt 0 ]; then
    reason="ローカルとリモートが分岐している (ローカル ${ahead} 件 / リモート ${behind} 件)。手動で rebase か merge が必要"
  elif [ "${behind:-0}" -gt 0 ]; then
    reason="リモートに ${behind} 件の新規コミットがあるが、未コミット変更が更新対象と衝突している"
  else
    reason="ff-only merge に失敗 (原因不明)"
  fi
  echo "pull: failed (${reason})"
}

# upstream (無ければ remote/branch) から見て未 push のコミットを列挙する
list_unpushed() {
  local upstream
  upstream=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
  [ -n "$upstream" ] || upstream="${REMOTE}/${BRANCH}"
  git -C "$REPO_ROOT" rev-parse --verify --quiet "$upstream" >/dev/null 2>&1 || return 0
  git -C "$REPO_ROOT" log --oneline "${upstream}..HEAD" 2>/dev/null | head -20
}

cmd_context() {
  # skill の `!` 展開から呼ばれる。何があっても exit 0 で終わる。
  # --pull を渡すと、コンテキストを読む前に ff-only で最新化する。
  local want_pull=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --pull) want_pull=1; shift ;;
      --no-pull) want_pull=0; shift ;;
      *) shift ;;
    esac
  done
  if ! require_jq; then return 0; fi

  local rc
  load_config
  rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "STATUS: unconfigured"
    echo "設定ファイルが無い: ${CONFIG_PATH}"
    echo "この skill は実行できない。ユーザーに /obsidian-grok:setup を案内して終了すること。"
    return 0
  fi
  if [ "$rc" -eq 3 ]; then
    echo "STATUS: invalid"
    echo "設定ファイルが JSON として壊れている: ${CONFIG_PATH}"
    echo "この skill は実行できない。ユーザーに /obsidian-grok:setup を案内して終了すること。"
    return 0
  fi

  validate_config
  if has_problems; then
    echo "STATUS: invalid"
    echo "config: ${CONFIG_PATH}"
    print_problems
    echo "この skill は実行できない。ユーザーに /obsidian-grok:setup を案内して終了すること。"
    return 0
  fi

  local today note
  today=$(date +%F)
  note="${VAULT_DIR}/${today}.md"

  echo "STATUS: ok"
  echo "today: ${today}"
  echo "repoRoot: ${REPO_ROOT}"
  echo "vaultDir: ${VAULT_DIR}"
  echo "remote: ${REMOTE}"
  echo "branch: ${BRANCH}"
  echo "dailyNote: ${note}"
  if [ "$want_pull" -eq 1 ]; then
    do_pull
  else
    echo "pull: skipped (--pull 未指定)"
  fi
  echo
  echo "--- existing project notes (tag: ${PROJECT_TAG}) ---"
  local notes
  notes=$(list_project_notes "$PROJECT_TAG" "$VAULT_DIR")
  if [ -n "$notes" ]; then printf '%s\n' "$notes"; else echo "(なし)"; fi
  echo
  echo "--- git status ---"
  git -C "$REPO_ROOT" status -sb 2>&1 | head -1
  local dirty count
  dirty=$(git -C "$REPO_ROOT" status --short 2>&1)
  if [ -z "$dirty" ]; then
    echo "(clean)"
  else
    count=$(printf '%s\n' "$dirty" | grep -c .)
    printf '%s\n' "$dirty" | head -50
    [ "$count" -gt 50 ] && echo "(... 他 $((count - 50)) 件は省略)"
  fi
  echo
  echo "--- 未 push のコミット ---"
  local unpushed
  unpushed=$(list_unpushed)
  if [ -n "$unpushed" ]; then
    printf '%s\n' "$unpushed"
    echo "(日報を push すると、これらも一緒に ${REMOTE}/${BRANCH} へ送られる)"
  else
    echo "(なし)"
  fi
  echo
  echo "--- today's daily note (${note}) ---"
  if [ -f "$note" ]; then cat "$note"; else echo "(未作成)"; fi
  return 0
}

usage_write() {
  cat <<'EOF'
usage: obsidian-grok.sh write --repo-root <絶対パス> [--vault-dir <絶対パス>]
                            [--remote <名前>] [--branch <名前>]
                            [--project-tag <タグ>] [--force]

  --repo-root    Obsidian vault を管理している git リポジトリのルート (必須)
  --vault-dir    デイリーノート / プロジェクトノートを置くディレクトリ (既定: repoRoot)
  --remote       push 先リモート (既定: origin)
  --branch       push 先ブランチ (既定: main)
  --project-tag  プロジェクトノートを識別する frontmatter の tag (既定: project)
  --force        既存の設定ファイルを確認なしで上書きする
EOF
}

cmd_write() {
  require_jq || return 1

  # 書き込み先は常に Grok 側。Claude 設定を読めても上書きしない。
  if [ -z "${OBSIDIAN_GROK_CONFIG:-}" ]; then
    CONFIG_PATH="${HOME}/.grok/obsidian-grok.json"
  fi

  local in_repo="" in_vault="" in_remote="origin" in_branch="main" in_tag="project" force=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --repo-root) in_repo="${2:-}"; shift 2 ;;
      --vault-dir) in_vault="${2:-}"; shift 2 ;;
      --remote) in_remote="${2:-}"; shift 2 ;;
      --branch) in_branch="${2:-}"; shift 2 ;;
      --project-tag) in_tag="${2:-}"; shift 2 ;;
      --force) force=1; shift ;;
      -h | --help) usage_write; return 0 ;;
      *) echo "STATUS: usage-error"; echo "不明な引数: $1"; usage_write; return 2 ;;
    esac
  done

  if [ -z "$in_repo" ]; then
    echo "STATUS: usage-error"
    echo "--repo-root は必須。"
    usage_write
    return 2
  fi

  REPO_ROOT=$(normalize_dir "$in_repo")
  VAULT_DIR=$(normalize_dir "${in_vault:-$in_repo}")
  REMOTE="$in_remote"
  BRANCH="$in_branch"
  PROJECT_TAG="$in_tag"

  validate_config
  if has_problems; then
    echo "STATUS: invalid"
    echo "検証に失敗したので設定ファイルは書かなかった:"
    print_problems
    return 1
  fi

  if [ -f "$CONFIG_PATH" ] && [ "$force" -eq 0 ]; then
    echo "STATUS: exists"
    echo "既に設定ファイルがある: ${CONFIG_PATH}"
    echo "現在の内容:"
    cat "$CONFIG_PATH"
    echo "上書きするなら --force を付けて再実行する。"
    return 1
  fi

  mkdir -p "$(dirname "$CONFIG_PATH")" || { echo "STATUS: error"; echo "設定ディレクトリを作れない"; return 1; }

  local tmp
  tmp="${CONFIG_PATH}.tmp.$$"
  if ! jq -n \
    --arg repoRoot "$REPO_ROOT" \
    --arg vaultDir "$VAULT_DIR" \
    --arg remote "$REMOTE" \
    --arg branch "$BRANCH" \
    --arg projectTag "$PROJECT_TAG" \
    '{repoRoot: $repoRoot, vaultDir: $vaultDir, remote: $remote, branch: $branch, projectTag: $projectTag}' \
    >"$tmp" 2>/dev/null; then
    rm -f "$tmp"
    echo "STATUS: error"
    echo "設定ファイルの生成に失敗した"
    return 1
  fi
  mv "$tmp" "$CONFIG_PATH" || { rm -f "$tmp"; echo "STATUS: error"; echo "設定ファイルの書き込みに失敗した"; return 1; }

  echo "STATUS: written"
  echo "config: ${CONFIG_PATH}"
  cat "$CONFIG_PATH"
  echo "gitAllowRule: Bash(git -C ${REPO_ROOT} *)"
  return 0
}

cmd_allow_git() {
  require_jq || return 1
  load_config >/dev/null 2>&1 || { echo "STATUS: unconfigured"; echo "先に write で設定ファイルを作る。"; return 1; }
  validate_config
  if has_problems; then
    echo "STATUS: invalid"
    print_problems
    return 1
  fi

  local rule_grok="Bash(git -C ${REPO_ROOT} *)"
  local rule_claude="Bash(git -C ${REPO_ROOT}:*)"

  if [ -f "$CLAUDE_SETTINGS_PATH" ] && jq -e --arg rule "$rule_claude" '(.permissions.allow // []) | index($rule)' "$CLAUDE_SETTINGS_PATH" >/dev/null 2>&1; then
    echo "STATUS: already"
    echo "既に許可済み (Claude settings, Grok も読む): ${rule_claude}"
    return 0
  fi
  if [ -f "$GROK_CONFIG_PATH" ] && grep -Fq "$rule_grok" "$GROK_CONFIG_PATH"; then
    echo "STATUS: already"
    echo "既に許可済み: ${rule_grok}"
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "STATUS: error"
    echo "python3 が無いので ~/.grok/config.toml を更新できない。手動で [permission] allow に次を足す: ${rule_grok}"
    return 1
  fi

  mkdir -p "$(dirname "$GROK_CONFIG_PATH")" || { echo "STATUS: error"; echo "設定ディレクトリを作れない"; return 1; }

  local backup=""
  if [ -f "$GROK_CONFIG_PATH" ]; then
    backup="${GROK_CONFIG_PATH}.obsidian-grok.bak"
    cp "$GROK_CONFIG_PATH" "$backup" || { echo "STATUS: error"; echo "バックアップに失敗した"; return 1; }
  fi

  if ! python3 - "$GROK_CONFIG_PATH" "$rule_grok" <<'PY'
import os, sys
path, rule = sys.argv[1], sys.argv[2]
text = ""
if os.path.exists(path):
    with open(path, "r") as f:
        text = f.read()
if rule in text:
    sys.exit(0)
needle = "allow = ["
idx = text.find(needle)
if idx >= 0:
    insert_at = idx + len(needle)
    text = text[:insert_at] + '\n  "' + rule + '",' + text[insert_at:]
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += '\n[permission]\nallow = [\n  "' + rule + '",\n]\n'
tmp = path + ".tmp." + str(os.getpid())
with open(tmp, "w") as f:
    f.write(text)
os.rename(tmp, path)
PY
  then
    echo "STATUS: error"
    echo "config.toml の更新に失敗した (元のファイルは変更していない)"
    return 1
  fi

  echo "STATUS: added"
  echo "settings: ${GROK_CONFIG_PATH}"
  echo "rule: ${rule_grok}"
  [ -n "$backup" ] && echo "backup: ${backup}"
  return 0
}

main() {
  local sub="${1:-check}"
  [ $# -gt 0 ] && shift
  case "$sub" in
    check) cmd_check "$@" ;;
    context) cmd_context "$@" ;;
    env) cmd_env "$@" ;;
    write) cmd_write "$@" ;;
    allow-git) cmd_allow_git "$@" ;;
    path) cmd_path "$@" ;;
    -h | --help | help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    *)
      echo "STATUS: usage-error"
      echo "不明なサブコマンド: ${sub}"
      return 2
      ;;
  esac
}

main "$@"
