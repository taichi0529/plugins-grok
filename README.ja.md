# plugins-grok

[English README is here](README.md)

[Grok Build](https://x.ai) 用のプラグインマーケットプレイス。各プラグインは `plugins/<name>/` 配下にあり、使い方はそれぞれの README に記載している。

Claude Code 用マーケットプレイス [plugins-cc](https://github.com/taichi0529/plugins-cc) の移植。Grok を Claude から呼ぶ `grok-cc` は、Grok 上では循環になるため含めていない。代わりに逆方向の `codex-grok` と `claude-grok` がある。

## プラグイン一覧

| プラグイン | 内容 | ドキュメント |
|---|---|---|
| `workflow-grok` | PROGRESS.md 永続化フック (リポジトリごとのオプトイン) + issue 駆動開発のための `implement-issue` / `run-epic` / `create-issue` skill。 | [README](plugins/workflow-grok/README.md) |
| `obsidian-grok` | セッションの作業内容を Obsidian vault のデイリーノートに日報として記録し、commit / push する `daily-report` skill。vault のパスは `/setup` で設定する。 | [README](plugins/obsidian-grok/README.md) |
| `codex-grok` | Grok から Codex を呼び、レビューや rescue 委譲を行う。 | [README](plugins/codex-grok/README.md) |
| `claude-grok` | Grok から Claude Code を呼び、レビューや rescue 委譲を行う。 | [README](plugins/claude-grok/README.md) |

## インストール

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install workflow-grok --trust
grok plugin install obsidian-grok --trust
grok plugin install codex-grok --trust
grok plugin install claude-grok --trust
```

必要なもの・インストール後のセットアップは各プラグインの README を参照。

### ローカル開発

```bash
git clone https://github.com/taichi0529/plugins-grok.git
grok plugin install ./plugins-grok/plugins/<name> --trust
```

### 秘匿情報のスキャン

コミット前に [gitleaks](https://github.com/gitleaks/gitleaks) が走る。git hook は clone に含まれないので、clone 後に 1 回だけ有効化する:

```bash
brew install pre-commit gitleaks jq
pre-commit install
```

`bash scripts/check-versions.sh` は `plugin.json` と `.grok-plugin/marketplace.json` の version が一致しているかを見る。どちらかをステージしたコミットでは pre-commit も同じ検査をする (`--quiet` は OK 行を省く。失敗は stderr)。

既定ルール (API キー・トークン・秘密鍵) に加えて、`.gitleaks.toml` で**ローカル絶対パス** (`/Users/<name>/` `/home/<name>/`) と**メールアドレス**を検出する。ドキュメントの例示には `/Users/you/` `<name>` `example.com` を使うこと (allowlist 済み)。検出されたら `--no-verify` で回避せず内容を直す。

## リポジトリ構成

- `.grok-plugin/marketplace.json` — マーケットプレイス定義
- `plugins/<name>/` — プラグインごとのディレクトリ。それぞれが `plugin.json` と README を持つ

## ライセンス

Apache License 2.0 ([LICENSE](LICENSE) を参照)。
