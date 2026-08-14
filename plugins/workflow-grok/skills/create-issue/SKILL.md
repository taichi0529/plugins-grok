---
name: create-issue
description: GitHub Issue を PBI (Product Backlog Item) 形式で日本語作成する (リポジトリ非依存)。User Story、Acceptance Criteria (Given/When/Then)、Definition of Done、技術情報を含む構造化された Issue を生成する。「Issue作って」「PBI書いて」「チケット起票して」などのリクエスト時に使用。EPIC (複数 Issue の親子管理・Sub-issues API) にも対応。「EPICを作って」「まとめて」などのリクエストで EPIC 作成。
---

# GitHub Issue (PBI) 作成スキル (汎用)

> 外部ライブラリ・フレームワークを使う Issue を作るときは、利用可能なドキュメント MCP (例: context7) で最新情報を確認すること。古い情報に基づいた Issue は避ける。

## リポジトリ設定の解決 (最初に 1 回)

ハードコード禁止。以下を解決してから起票する:

| 項目 | 解決方法 |
|---|---|
| repo slug | `gh repo view --json nameWithOwner -q .nameWithOwner` (以下 `$REPO`。cwd がリポジトリ内なら gh コマンドの `--repo` は省略可) |
| プロジェクト文脈 | **リポジトリの AGENTS.md を必ず読む** (無ければ CLAUDE.md)。ドメイン・対象ユーザー・技術スタック・規約はここが正 |
| DoD | ① 設定ファイルのルート `dodFiles` + 起票対象の Target scope にマッチする `scopes[]` の `dodFiles` → ② `.grok/dod/*.md` → ③ `.claude/dod/*.md` → ④ どちらも無ければ **DoD セクションを省略して起票** |
| ベースブランチ | 設定ファイル (同上) の `baseBranch` → 無ければ `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` (Task のブランチ/PR 説明に使う) |

設定ファイルのスキーマ・解決規則の正典は implement-issue SKILL.md の「リポジトリ設定の解決」。create-issue は変更 diff を持たないため **repo-wide フィールドのみ**使い、scope 別の `dodFiles` は起票時に Target scope が宣言される場合だけ union する。設定は `.grok/workflow-grok.json`、無ければ `.claude/workflow-cc.json`。

## 分類軸 (type)

| タイプ | 説明 | テンプレート | User Story |
|--------|------|-------------|------------|
| **feature** | 新機能追加 | `templates/feature.md` | 適切 |
| **bug** | バグ修正 | `templates/bug.md` | 不適切 |
| **refactor** | コード改善 (機能変更なし) | `templates/refactor.md` | 不適切 |
| **chore** | 雑務 (依存更新、設定変更、ドキュメント) | `templates/chore.md` | 不適切 |
| **epic** | 複数 Feature をまとめる最上位 | `templates/epic.md` | 不適切 |
| **task** | 1PR で完結する実装タスク (Feature の子) | `templates/task.md` | 不適切 |

テンプレートは本スキルと同じディレクトリの `templates/` にある (本 SKILL.md からの相対パス)。

## 判定フロー

```
1. ユーザーの要求を分析
   ↓
2. 曖昧さチェック (下記参照)
   - 曖昧 → `ask_user_question` でヒアリング
   - 具体的 → Step 3 へスキップ
   ↓
3. 作業タイプを判定 (feature / bug / refactor / chore / epic / task)
   ↓
4. 外部ライブラリを使用する場合 → 利用可能なら context7 で最新情報取得
   ↓
5. テンプレート + DoD (解決済み) を組み合わせて Issue 生成
```

## 曖昧さチェック & ヒアリング

### 曖昧と判定する条件

| 条件 | 例 |
|------|-----|
| **ゴールが不明確** | 「〇〇を改善したい」(何をどう改善?) |
| **対象ユーザーが不明** | 誰が使う機能か分からない |
| **具体的な振る舞いが不明** | 「〇〇機能」(どの画面? どう表示?) |
| **技術選定が必要** | 複数の実装方法が考えられる |
| **スコープが広すぎる** | 1 Issue で収まらない可能性 |

### 具体的と判定する条件 (ヒアリング不要)

- ゴール・目的が明確
- 対象ユーザー (リポジトリのドメインにおける利用者種別) が特定できる
- 対象の画面・モジュール・機能が特定できる
- 具体的な振る舞いが説明されている

### ヒアリング項目 (曖昧な場合に `ask_user_question` で)

1. 目的・ゴール / 2. 対象ユーザー / 3. 具体的な振る舞い (入力→処理→出力) / 4. 対象画面・モジュール / 5. 制約・スコープ外 / 6. 技術的な制約 / 7. 優先度・期日

## Issue 構成

```markdown
## [作業タイプに応じたセクション]
<!-- templates/*.md から -->

---

## Acceptance Criteria
<!-- Given/When/Then 形式 -->

---

## Definition of Done
<!-- 解決済み DoD (設定ファイルの dodFiles / .grok/dod/*.md / .claude/dod/*.md)。無ければこのセクションごと省略 -->

---

## 技術情報
<!-- 対象モジュール / 影響範囲 / 実装方針。語彙・パスはリポジトリの実コードと AGENTS.md / CLAUDE.md から -->

---

## 参考
- 関連 Issue/PR:
- その他:
```

## Issue 作成手順

1. **タイプ判定** → 2. **テンプレート選択** (`templates/`) → 3. **DoD 構成** (解決済み) → 4. **内容記載** → 5. **一時ファイル保存** (scratchpad 等) → 6. **作成**:

```bash
gh issue create \
  --title "[タイプ] タイトル" \
  --body-file <一時ファイル> \
  --label "<タイプラベル>"
```

## タイトル規則

```
[タイプ] 具体的な内容

例:
[Feature] 〇〇一覧に絞り込み機能を追加する
[Bug] 〇〇更新後に一覧へ反映されない
[Refactor] 〇〇サービスの重複ロジックを整理する
[Chore] 〇〇を最新版に更新する
```

## ラベル規則

| 用途 | ラベル | 色 |
|--------|--------|-----|
| feature | `enhancement` | #a2eeef |
| bug | `bug` | #d73a4a |
| refactor | `refactor` | #fbca04 |
| chore | `chore` | #c5def5 |
| EPIC 階層 | `epic` | #5319e7 |
| Task 階層 | `task` | #d4c5f9 |
| 優先度 (任意) | `priority:critical` #b60205 / `priority:high` #d93f0b / `priority:low` #0e8a16 | |

ラベルが無ければ `gh label create <name> --color <色> --description "..."` で作成する (enhancement / bug は GitHub デフォルトで存在)。

## Issue 階層構造 (EPIC / Feature / Task)

GitHub の **Sub-issues 機能**で階層管理する:

```
EPIC (Level 1) - プロジェクト全体 (数週間〜)
├── Feature (Level 2) - 個別の機能要件 (数日〜)
│   ├── Task (Level 3) - 実装タスク・1PR 単位 (数時間〜数日)
│   └── Task (Level 3)
└── Feature (Level 2)
```

- 進捗は Sub-issues の自動進捗バーで管理 (子 issue close で自動更新)。ローカル todo ファイルは持たない
- 最大 100 子 / 8 階層。API レート制限に注意

### 親子の紐づけ (実測で動作確認済みの手順)

```bash
# 子 issue の database id を取得 (number ではない)
CHILD_ID=$(gh api repos/$REPO/issues/<子番号> --jq .id)

# 親のサブイシューとして追加
gh api -X POST repos/$REPO/issues/<親番号>/sub_issues -F sub_issue_id=$CHILD_ID

# 確認
gh api repos/$REPO/issues/<親番号>/sub_issues --jq '.[] | {number, title, state}'
```

### EPIC 作成フロー

```
1. ユーザーの大規模要求を分析し Feature に分割
2. 分割案をユーザーに確認 (`ask_user_question`)
3. EPIC Issue 作成 (--label epic、本文はチェックボックス形式の子リスト付き)
4. Feature Issue を順次作成 (--label enhancement)
5. 各 Feature を EPIC のサブイシューとして紐づけ (上記手順)
```

EPIC の子リストのチェックボックスは **PR merge → 子 issue close の後に**進む (run-epic は merge 前にチェックを付けない — 未完了作業の完了偽装防止)。Sub-issues の登録順は run-epic の基本処理順であり、**依存宣言が無い場合のタイブレーク**。依存順・優先度順に登録すること。

### 依存とスコープの宣言 (run-epic の並列トリアージが機械的に読む)

EPIC 配下の子 issue 本文には、可能な限り以下の機械可読ブロックを含める (無くてもエラーにはならないが、run-epic の `parallel≥2` 実行時に保守的直列へ落ちるだけ):

```markdown
## 依存

depends on: #12, #34   <!-- 依存が無ければ: depends on: none -->

## Target scope

apps/web               <!-- 主に触るリポジトリ相対パス。複数はカンマ区切り -->
```

- `depends on:` は run-epic が**コード依存** (依存先の PR merge を待つ) として解釈する
- 既存テンプレ由来の `## Blocked by` 配下の `#N` も互換として同義に解釈される
- `Target scope` が互いに異なる (prefix 非共有の) 子同士だけが run-epic の並列実行候補になる

## 関連スキル

- `implement-issue`: 起票した Issue の実装 (1 Task = 1 PR)
- `run-epic`: EPIC の OPEN な Sub-issues を実装 (既定直列、`parallel=N` で独立子の wave 並列)
