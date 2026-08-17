# Grok 用 Claude プラグイン

[English README is here](README.md)

[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) を Grok から呼び出すプラグイン。[grok-cc](https://github.com/taichi0529/plugins-cc) の逆方向: ホストが Grok、バックエンドが `claude -p --output-format stream-json`。

## 必要なもの

- Node.js
- Claude Code CLI:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

- 認証: 一度 `claude auth login` を実行 (または `ANTHROPIC_API_KEY` を設定)

## インストール

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install claude-grok --trust
```

インストール後に `/claude-grok:setup` で確認する。

## コマンド

スラッシュコマンドは `claude-grok` 名前空間。ほとんどは `scripts/claude-companion.mjs` を実行し、stdout を**加工せず**返す。

| コマンド | 内容 |
|---|---|
| `/claude-grok:setup` | Node と Claude の導入・認証確認。停止時レビューゲートの切替 |
| `/claude-grok:rescue` | 調査・修正を `claude-grok:claude-rescue` に委譲 |
| `/claude-grok:review` | ローカル git 変更の構造化レビュー (focus テキスト不可) |
| `/claude-grok:adversarial-review` | 敵対的レビュー。focus テキスト可 |
| `/claude-grok:status` | ジョブ一覧 / 完了待ち |
| `/claude-grok:result` | 完了ジョブの保存済み出力 |
| `/claude-grok:cancel` | バックグラウンドジョブのキャンセル |
| `/claude-grok:transfer` | 現在の Grok セッションから Claude スレッドを作る |

書き込みタスクは `--permission-mode bypassPermissions`、レビューと読み取り専用は `plan`。

`grok-cc` と組み合わせて互いに呼び合う循環は作らないこと。

## ライセンス

Apache License 2.0。NOTICE を参照。
