# AGENTS.md — obsidian-grok

`plugins/obsidian-grok/` で作業するときのガイド。マーケットプレイス全体はルートの `AGENTS.md` を参照。

## 概要

Grok セッションの作業を Obsidian vault のデイリーノートに日報として書き、commit / push する。Claude 版 `obsidian-cc` の移植。

| ファイル | 役割 |
|---|---|
| `skills/daily-report/SKILL.md` | 日報の手順書。判断は本体セッション、書き込みはサブエージェント |
| `skills/setup/SKILL.md` | `/obsidian-grok:setup`。設定ファイルの作成・検証 |
| `scripts/obsidian-grok.sh` | 設定の検証・書き込みと実行時コンテキスト収集。bash + git + jq |

## 不変条件

1. **git コマンドは必ず `-C <repoRoot>`**。`cd` してからの実行は禁止
2. **設定は `scripts/obsidian-grok.sh` 経由でしか触らない**
3. **`vaultDir` は `repoRoot` 配下**
4. **書き込み前に `ask_user_question` で 1 回だけ確認**
5. **最新化は fast-forward 限定** (`do_pull`)。ff できないなら何もせず理由を返す
6. **`context` は常に exit 0**

## ヘルパーの契約

サブコマンドは `check` / `context` / `env` / `write` / `allow-git` / `path`。

- 出力の 1 行目は必ず `STATUS: <値>`
- 設定パス: `$OBSIDIAN_GROK_CONFIG` → `~/.grok/obsidian-grok.json` → 読み取りフォールバック `~/.claude/obsidian-cc.json`
- `write` は常に `~/.grok/obsidian-grok.json` に書く (Claude 設定は上書きしない)
- `allow-git` は `~/.grok/config.toml` に追記。既存の Claude `settings.json` に同じルールがあれば何もしない
- bash 3.2 互換。配列は使わない。`set -e` も使わない

## 検証

```bash
bash -n scripts/obsidian-grok.sh

tmp=$(mktemp -d)
git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/vault"
git -C "$tmp/vault" remote add origin "$tmp/remote.git"
mkdir -p "$tmp/vault/notes"
printf -- '---\ntags:\n  - project\n---\n' > "$tmp/vault/notes/Foo.md"
git -C "$tmp/vault" add -A
git -C "$tmp/vault" -c user.email=t@example.com -c user.name=t commit -qm init

export OBSIDIAN_GROK_CONFIG="$tmp/config.json"
scripts/obsidian-grok.sh check      # → STATUS: unconfigured
scripts/obsidian-grok.sh write --repo-root "$tmp/vault" --vault-dir "$tmp/vault/notes"
scripts/obsidian-grok.sh context    # → STATUS: ok / Foo が列挙される
```

## 注意

- skill 名は `daily-report` / `setup`。呼び出しは `/obsidian-grok:daily-report` / `/obsidian-grok:setup`
- `daily-report` は `disable-model-invocation: true`
- バージョンを上げるときは `plugin.json` とルートの `.grok-plugin/marketplace.json` を両方同じ値にする
