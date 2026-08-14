---
name: daily-report
description: 今日の作業内容を Obsidian のデイリーノートに書き込み、commit して push する。Use when the user runs /daily-report or asks to write a daily note to Obsidian.
argument-hint: "[補足したい内容（任意）]"
disable-model-invocation: true
allowed-tools:
  - read_file
  - ask_user_question
  - spawn_subagent
  - run_terminal_command
---

# 日報を Obsidian に記録する

## 実行時コンテキスト

次を `run_terminal_command` で実行する。失敗しても続行し、先頭行の `STATUS:` で分岐する。

```bash
"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh context --pull
```

- ユーザーからの補足: $ARGUMENTS

**上の出力が唯一の事実源。** パス・日付・ブランチ・既存ノートは会話の文脈から推測せず、必ずこの出力の値を使う。

| 名前 | 出力中のキー | 用途 |
| --- | --- | --- |
| `<repoRoot>` | `repoRoot` | git リポジトリルート。すべての git コマンドの `-C` に渡す |
| `<vaultDir>` | `vaultDir` | デイリーノート / プロジェクトノートの置き場 |
| `<today>` | `today` | 今日の日付 (`YYYY-MM-DD`) |
| `<dailyNote>` | `dailyNote` | `<vaultDir>/<today>.md` |
| `<remote>` / `<branch>` | `remote` / `branch` | push 先 |

**このスキルはどのプロジェクトのセッションからでも呼ばれる。** git 操作は必ず `git -C <repoRoot>` を使い、カレントディレクトリのリポジトリには絶対に触れない。

---

## 手順

### 0. 設定と同期の確認

コンテキスト出力の 1 行目が `STATUS: ok` でなければ、**何も書かずに終了する**。ユーザーには「`/obsidian-grok:setup` を実行して Obsidian の設定を作ってほしい」と伝え、出力に含まれる問題点をそのまま示す。設定を自分で書きに行かないこと。

次に `pull:` の行を見る。

- `up-to-date` / `fast-forwarded <old>..<new>` → そのまま進む
- `skipped (...)` → 理由をユーザーに伝えてから進む
- `failed (...)` → **書き込みに進まず、ユーザーに判断を仰ぐ**

「未 push のコミット」が列挙されている場合、日報を push するとそれらも一緒に送られる。手順 3 で明示する。

### 1. 作業内容の収集（本体セッションで実行）

現在のセッションの会話から、今日行った作業を抽出する。補足が渡されていればそれも併合する。

会話に記録すべき作業実績が無い場合は、**何も書かずにその旨を伝えて終了する**。空の日報を作らない。

### 2. プロジェクトの特定

コンテキスト出力の「existing project notes」と照合し、該当するものを `[[名前]]` 形式のリンクにする。該当が無ければ無理にプロジェクトノートを新規作成しない。

### 3. ドラフト提示と確認（本体セッションで実行）

以下を提示する。

- デイリーノートへの追記内容
- 各プロジェクトノートへの追記内容
- 既存の表・チェックボックスの更新が必要と判断した場合は、その提案（勝手に適用しない）

提示したうえで `ask_user_question` を使い、**1 回だけ**確認を取る。ここが唯一の歯止めになる。

承認されなければ何も書かずに終了する。

### 4. 書き込み・commit・push（サブエージェントに委譲）

承認後、`spawn_subagent` で以下を指定して起動する。

- `subagent_type`: `general-purpose`
- `background`: `false`
- `description`: `"Obsidian 日報の書き込みと push"`
- モデルは指定しない（セッションを継承）

プロンプトには**承認済みのドラフト全文**と、下の「書き込み規約」「禁止事項」を丸ごと埋め込む。`<repoRoot>` などのプレースホルダは**実際の値に展開してから**渡す。

サブエージェントには次を報告させる。

- 変更したファイルの一覧
- commit hash と `git -C <repoRoot> show --stat HEAD`
- pre-commit フックの結果
- push の直前に実行した `git -C <repoRoot> log --oneline <remote>/<branch>..HEAD`
- push の可否（`git -C <repoRoot> status -sb`）
- `git -C <repoRoot> diff HEAD~1 HEAD --numstat`（追記のみで削除が 0 行であること。最初のコミットで `HEAD~1` が無い場合は `show --stat HEAD` だけ）

作業ツリーに無関係な未コミット変更がある場合は、それらを一切 `git add` しないよう明示する。

### 5. 結果報告

サブエージェントの返答をユーザーに報告する。失敗した項目があれば隠さずそのまま伝える。

---

## 書き込み規約

### デイリーノート

ファイル名は `<today>.md`（`YYYY-MM-DD.md`）で**固定**。

- 既に存在する場合は**追記**する。上書きしない
- 存在しない場合は frontmatter 付きで新規作成する

```markdown
---
tags:
  - daily
projects:
  - "[[ProjectName]]"
---

## 今日やったこと

- ...
```

- `projects` は既存の値を保持したうえでマージする
- 本文は `## 今日やったこと` 配下に箇条書きを追加する。見出しが無ければ作る

### プロジェクトノート

**追記のみ。既存行の書き換えは禁止。**

- 該当する `### <トピック>` 見出しの配下に `- <today>: <内容>（[[<today>]]）` を追加する
- 該当する見出しが無ければ `## トピック` 配下に新しい `###` を作る
- 手書きの表・callout・チェックボックスには触れない
- それらの更新が必要な場合は手順 3 で提案し、承認された分だけ適用する

### commit / push

**すべての git コマンドに例外なく `-C <repoRoot>` を付ける。** `cd` してから実行する方式は禁止。

```bash
git -C <repoRoot> add <触ったファイルのみ>
git -C <repoRoot> commit -m "$(cat <<'EOF'
add: <today> の日報を更新

Co-Authored-By: Grok <noreply@x.ai>
EOF
)"
git -C <repoRoot> push <remote> <branch>
```

実行前に `git -C <repoRoot> rev-parse --show-toplevel` の出力が `<repoRoot>` と一致することを確認する。

---

## 禁止事項

- `git commit --no-verify`。検出されたら握り潰さず、理由を報告して中断する
- `-C` を省略した git コマンド、および `cd` による移動
- `git add -A` / `git add .`
- `<vaultDir>` の外への書き込み
- 会話に根拠のない内容の創作。不明な点は `> [!todo] 未記入` の callout として残す
- デイリーノート・プロジェクトノートの既存内容の削除や上書き
