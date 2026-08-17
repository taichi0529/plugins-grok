# Grok 用 Codex プラグイン

[English README is here](README.md)

[Codex CLI](https://github.com/openai/codex) を Grok から呼び出すプラグイン。OpenAI の Codex plugin for Claude Code と [grok-cc](https://github.com/taichi0529/plugins-cc) の派生物で、ホストを Grok、バックエンドを `codex exec --json` にしている。

## 必要なもの

- Node.js
- Codex CLI (`npm i -g @openai/codex`)
- 認証: 一度 `codex login` を実行 (または `OPENAI_API_KEY` を設定)

## インストール

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install codex-grok --trust
```

インストール後に `/codex-grok:setup` で確認する。

## コマンド

スラッシュコマンドは `codex-grok` 名前空間。ほとんどは `scripts/codex-companion.mjs` を実行し、stdout を**加工せず**返す。

| コマンド | 内容 |
|---|---|
| `/codex-grok:setup` | Node と Codex の導入・認証確認。停止時レビューゲートの切替 |
| `/codex-grok:rescue` | 調査・修正を `codex-grok:codex-rescue` に委譲 |
| `/codex-grok:review` | ローカル git 変更の構造化レビュー (focus テキスト不可) |
| `/codex-grok:adversarial-review` | 敵対的レビュー。focus テキスト可 |
| `/codex-grok:status` | ジョブ一覧 / 完了待ち |
| `/codex-grok:result` | 完了ジョブの保存済み出力 |
| `/codex-grok:cancel` | バックグラウンドジョブのキャンセル |
| `/codex-grok:transfer` | 現在の Grok セッションから Codex スレッドを作る |

書き込みタスクはサンドボックス `workspace-write`、レビューと読み取り専用は `read-only`。

## ライセンス

Apache License 2.0。NOTICE を参照。
