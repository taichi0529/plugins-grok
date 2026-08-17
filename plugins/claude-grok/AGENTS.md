# AGENTS.md — claude-grok

`plugins/claude-grok/` で作業するときのガイド。マーケットプレイス全体はルートの `AGENTS.md` を参照。

## 概要

Grok から Claude Code CLI を呼ぶプラグイン。grok-cc の逆方向移植。バックエンドは one-shot の `claude -p --output-format stream-json`。

| ファイル | 役割 |
|---|---|
| `commands/*.md` | `/claude-grok:*`。companion の stdout を verbatim で返す |
| `agents/claude-rescue.md` | 転送専用サブエージェント。`task` を 1 回だけ呼ぶ |
| `scripts/claude-companion.mjs` | ジョブライフサイクル |
| `scripts/lib/claude.mjs` | **ここだけが claude プロセスを起動する** |

## 検証

```bash
for f in plugins/claude-grok/scripts/*.mjs plugins/claude-grok/scripts/lib/*.mjs; do node --check "$f"; done
node plugins/claude-grok/scripts/claude-companion.mjs setup --json
```

## 不変条件

1. companion の stdout は加工しない
2. レビュー結果から勝手に修正しない
3. セッション env は `CLAUDE_COMPANION_DATA` / `CLAUDE_COMPANION_SESSION_ID`
4. フック stdin は camelCase を正とし、snake_case はフォールバック
5. バージョンは `plugin.json` とルート `marketplace.json` を同じ値にする

## 注意

- 書き込みは `--permission-mode bypassPermissions`、レビューは `plan`
- `--resume-last` は companion が記録した threadId のみから解決する
- モデルエイリアス: `fast` / `haiku` → `haiku`。`sonnet` / `opus` はそのまま
- `claude-grok` と Claude 側の `grok-cc` を同じセッションで循環させない
