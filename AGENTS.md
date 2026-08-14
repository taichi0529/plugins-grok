# AGENTS.md

このリポジトリで作業する Grok 向けのガイド。Grok Build 用プラグインのマーケットプレイス。

## 概要

ルートの `.grok-plugin/marketplace.json` がプラグイン一覧を定義し、本体は `plugins/<name>/` 配下。

| プラグイン | 概要 | 詳細 |
|---|---|---|
| `workflow-grok` | PROGRESS.md 永続化フック + create-issue / implement-issue / run-epic | `plugins/workflow-grok/AGENTS.md` |
| `obsidian-grok` | セッション作業を Obsidian デイリーノートに記録して commit / push | `plugins/obsidian-grok/AGENTS.md` |

個々のプラグインをいじるときは、その `AGENTS.md` を読む。この文書はマーケットプレイス共通事項だけを扱う。

Claude Code 版は別リポジトリ (`plugins-cc`)。こちらはフォークであり、単一ソースにはしていない。

## 構成

```
.grok-plugin/marketplace.json   # プラグインレジストリ
plugins/<name>/
  plugin.json                   # name / version / description
  AGENTS.md
  commands/  agents/  skills/  hooks/  scripts/ ...
```

- `marketplace.json` の各 `source` は `./plugins/<name>` を指す
- プラグイン同士に共有ライブラリや相互依存は無い

## 規約

- **バージョンは 2 箇所を一致させる**: `plugins/<name>/plugin.json` と `marketplace.json` の該当エントリを同じ値にする
- **フックスクリプトはプラグインルート基準**: `hooks/hooks.json` の command は `"${GROK_PLUGIN_ROOT}"/scripts/...`
- **stdin のフック JSON は camelCase** (`.toolInput`, `.stopHookActive`)。snake_case もフォールバックで読んでよい
- **コミット前に gitleaks** (`.pre-commit-config.yaml` + `.gitleaks.toml`)。clone 後に 1 回 `pre-commit install`。依存は `brew install pre-commit gitleaks`
- **`.gitleaks.toml` に固有名詞を書かない**。allowlist は公開して問題ない例示値だけ
- ビルド・テストランナーは無い。検証はプラグインごと (`bash -n`, `grok plugin validate`, helper を直接叩く)
- ライセンス: Apache-2.0

## インストール / ローカル開発

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install workflow-grok --trust
grok plugin install obsidian-grok --trust
```

単一プラグインを直接入れる:

```bash
grok plugin install /path/to/plugins-grok/plugins/<name> --trust
```

フックや skill の変更は Plugins タブの `r`、またはセッション再起動で反映される。
