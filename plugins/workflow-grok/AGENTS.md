# AGENTS.md — workflow-grok

`plugins/workflow-grok/` で作業するときのガイド。マーケットプレイス全体はルートの `AGENTS.md` を参照。パスはこのプラグインディレクトリからの相対。

## 概要

1. **PROGRESS.md 永続化フック 3 本** — git / issue に載らない情報 (plan との乖離・失敗したアプローチ・ハマりどころ・次の一手) だけを残す
2. **ワークフロー skill 群** — `create-issue` / `implement-issue` / `run-epic`。リポジトリ非依存

ビルド・テストランナーはない。フックは shell + `jq`、skill は Markdown 手順書。

## opt-in

フック 3 本は**リポジトリルートに `PROGRESS.md` が存在する時だけ**動く。無ければ即 `exit 0`。

```bash
touch PROGRESS.md
echo "PROGRESS.md" >> .gitignore
```

`jq` が無い環境ではフックは何もせず `exit 0` (fail-open)。依存は `jq` と `git` のみ。

## フック (`hooks/hooks.json` → `scripts/*.sh`)

Grok では `PostToolUse` は block できず、`SessionStart` の stdout も無視される。

- `session-start.sh` (SessionStart) → additionalContext を試す。効かなくても skill が PROGRESS.md を読む
- `pre-tool-use.sh` (PreToolUse, matcher: Bash) → **主役**。`toolInput.command` に `git commit` / `gh pr create` を検知し、mtime が 5 分超なら deny。ログ 10 件超は機械トリム (`touch -r` で mtime 保存)
- `stop.sh` (Stop) → バックストップ。`reason == "end_turn"` 以外は無視。`stopHookActive` が true なら即 exit 0。`HEAD_TS - mtime > 300` なら block (更新→commit の数秒差を誤検出しないため)

stdin は camelCase を正とし、snake_case はフォールバック。

## skills

- `create-issue` — PBI 形式の Issue 起票。`templates/*.md` 同梱。DoD は `.grok/workflow-grok.json` の `dodFiles` → `.claude/workflow-cc.json` → `.grok/dod/*.md` → `.claude/dod/*.md` → 省略
- `implement-issue` — Issue を内部ループ (最大 10 試行) で end-to-end 実装。**リポジトリ設定解決の正典**。既定レビュアーは `project` + `adversarial`。`review=grok` は廃止 (本体が Grok)
- `run-epic` — EPIC の OPEN な Sub-issues を `spawn_subagent` (`isolation: worktree`) へ委譲。既定は直列。Grok はサブエージェントをネストできないので、**レビューは親が 1b のあとで回す**。子は実装 + ゲート + PR まで

## リポジトリ設定

設定ファイルは `.grok/workflow-grok.json`、無ければ `.claude/workflow-cc.json`。どちらも無くても自動導出。**正典は `skills/implement-issue/SKILL.md` の「リポジトリ設定の解決」**。

| 項目 | 設定ファイル | 自動導出 |
|---|---|---|
| repo slug | — | `gh repo view --json nameWithOwner` |
| ベースブランチ | ルートの `baseBranch` | `gh repo view --json defaultBranchRef` |
| ローカルゲート | ルートの `gates` + マッチした `scopes[].gates` の union | ルート `package.json` の scripts |
| CI の扱い | ルートの `trustCI` (既定 true) | true なら PR 後に `gh pr checks` |
| レビュアー | ルートの `reviewers` + マッチ scope の union | `["project", "adversarial"]` |

- **二段階解決**: repo-wide は起動時、scope 依存はゲート実行直前に変更ファイル集合から
- **prefix マッチ**: `file == prefix` または `file.startswith(prefix + "/")`

## 注意

- `PROGRESS.md` に書いてよいのは **git / issue に無い情報だけ**
- バージョンを上げるときは `plugin.json` とルートの `.grok-plugin/marketplace.json` を両方同じ値にする
