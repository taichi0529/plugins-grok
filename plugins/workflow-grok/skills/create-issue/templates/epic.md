# EPIC テンプレート

大規模プロジェクトや複数 Feature をまとめる最上位 Issue 用。GitHub Sub-issues 機能で子を管理する。

---

## 構成

```markdown
## 概要

[この EPIC で実現する全体像を 1-2 文で]

## プロジェクト目標

[完了した時の状態・達成基準を箇条書き]

## スコープ外

[この EPIC に含めないもの]

## Sub-issues (上から順に実装・merge する)

<!-- 子 issue 作成後、番号付きチェックボックスで列挙。run-epic がこのチェックボックスを更新する -->
- [ ] #XX [タイトル]
- [ ] #YY [タイトル]

## 備考 (依存・merge 順序)

<!-- 子同士が同一ファイル・同一出力に触れる場合は merge 順と conflict 時の対処を明記。
     機械可読な依存は各子 issue 本文の「depends on: #N」/「## Target scope」で宣言する
     (run-epic の並列トリアージが解析する。EPIC 本文の散文は解析対象外) -->

## 完了条件

- [ ] すべての Sub-issue がクローズされている
- [ ] 各 Sub-issue の AC がすべて満たされている
- [ ] すべての PR がレビュー承認・merge されている
- [ ] リポジトリの検証ゲートが全 PR で pass している
```

---

## 運用ルール

- 進捗は GitHub Sub-issues の自動進捗バーで管理 (子 close で自動更新)。ローカル todo ファイルは持たない
- 親子の紐づけ手順・コマンドは SKILL.md の「親子の紐づけ」を参照 (database id を使う)
- **Sub-issues の登録順は run-epic の基本処理順** (依存宣言が無い場合のタイブレーク)。依存順・優先度順に登録する。処理順の正は各子 issue の `depends on:` / `Target scope` 宣言 + run-epic のトリアージ
- 子 issue の PR には `Closes #<子番号>` を入れ、merge 時の自動 close で進捗バーを進める
