# AGENTS.md — codex-grok

`plugins/codex-grok/` で作業するときのガイド。マーケットプレイス全体はルートの `AGENTS.md` を参照。

## 概要

Grok から Codex CLI を呼ぶプラグイン。Claude Code 用 Codex plugin / grok-cc の移植。バックエンドは `codex app-server` ではなく one-shot の `codex exec --json`。

| ファイル | 役割 |
|---|---|
| `commands/*.md` | `/codex-grok:*`。companion の stdout を verbatim で返す |
| `agents/codex-rescue.md` | 転送専用サブエージェント。`task` を 1 回だけ呼ぶ |
| `scripts/codex-companion.mjs` | ジョブライフサイクル |
| `scripts/lib/codex.mjs` | **ここだけが codex プロセスを起動する** |

## 検証

```bash
for f in plugins/codex-grok/scripts/*.mjs plugins/codex-grok/scripts/lib/*.mjs; do node --check "$f"; done
node plugins/codex-grok/scripts/codex-companion.mjs setup --json
```

## 不変条件

1. companion の stdout は加工しない
2. レビュー結果から勝手に修正しない
3. セッション env は `CODEX_COMPANION_DATA` / `CODEX_COMPANION_SESSION_ID`。汎用名 `GROK_PLUGIN_DATA` を session-wide に export しない
4. フック stdin は camelCase を正とし、snake_case はフォールバック
5. バージョンは `plugin.json` とルート `marketplace.json` を同じ値にする

## 注意

- app-server / broker は無い。キャンセルはプロセスツリーの terminate
- `--resume-last` は companion が記録した threadId のみから解決する
- 書き込みタスクの touchedFiles は git status の前後差分
- モデルエイリアス: `spark` → `gpt-5.3-codex-spark`
