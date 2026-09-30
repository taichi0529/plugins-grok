---
name: implement-issue
description: GitHub Issue を内部ループで end-to-end 実装するスキル (リポジトリ非依存)。ブランチ作成 → 実装 → ローカル検証 → コード整理 (/simplify、無ければ skip) → セキュリティレビュー → コミット → push → PR 作成 → コードレビュー → 修正までを「現在の状態を読み直し、次の1歩を進める」を最大10回繰り返して完了させる。「Issue 実装して」「#123 を実装」「implement issue」「イシューを実装」などのリクエスト時に使用。引数は Issue 番号 + 任意の review= / codex-model= / claude-model= 指定 (例 `42 review=codex,claude`)。
---

# Issue Implementation Skill (汎用)

GitHub Issue の実装を、ブランチ作成から PR 作成・レビュー対応まで**一度の実行で end-to-end** に完了させる。
本スキルは内部に有限ループ (最大 10 試行) を持ち、各試行は「現在の状態を自己診断 → 次に必要な1歩だけ進める」を繰り返して、成功条件を全て満たすか max 試行に達したら return する。

引数: `$ARGUMENTS`
- 第1引数: Issue 番号 (例: `42`, `#42`)
- 任意: `review=<reviewer,...>` (例: `review=codex` / `review=claude`)。自然言語での指定 (「codex でもレビューして」) も同義に解釈する。`review=grok` は無視する (本体が Grok)。既定は `project,adversarial` (別エンジンは opt-in。常設すると毎 PR で外部 CLI が走る)
- 任意: `codex-model=<モデル名>` / `claude-model=<モデル名>`。Step 5 の companion に渡す `--model`。省略時、および `=default` は `--model` を付けず各 CLI の既定を使う。設定ファイルには入れない (モデル選択は個人・コスト都合)

## 動作モード

このスキルは2つの方法で起動される。どちらの場合も同じアルゴリズムを実行する。

1. **直接起動** (`/implement-issue 42`): 現在のスレッドがそのままアルゴリズムを実行する
2. **run-epic からの委譲**: 親 (run-epic) が `spawn_subagent({subagent_type: "general-purpose", isolation: "worktree", prompt: "本スキルを読んでアルゴリズムを実行"})` で spawn し、子エージェントが本スキルを Read してアルゴリズムを実行する。Grok はサブエージェントをネストできないので、**子は Step 5 の spawn レビューをスキップ**し、親が 1b のあとでレビューする

直接起動時もメインコンテキストの汚染が気になるなら、子エージェントへ委譲してから本スキルを実行させる構成に切り替えてよい。判断はユーザーの状況次第。

## リポジトリ設定の解決 (正典 — run-epic / create-issue もこの規則を参照する)

ハードコード禁止。設定ファイルは次の順で最初に見つかった 1 つだけ読む。**無くても全項目が自動導出で動くこと。**

1. `.grok/workflow-grok.json`
2. `.claude/workflow-cc.json` (Claude 版との共用)

旧 `.claude/workflow.json` (〜0.4.x) は**読まない**。検出した場合は「`.claude/workflow.json` は廃止。`.grok/workflow-grok.json` か `.claude/workflow-cc.json` へリネームしてください (`scopes` 無しのフラット形式はそのまま有効)」と最終報告に案内する。

### 設定ファイルのスキーマとキー許可リスト

```json
{
  "baseBranch": "dev",
  "trustCI": true,
  "gates": ["npm run type-check"],
  "reviewers": ["project"],
  "dodFiles": [".grok/dod/common.md"],
  "scopes": [
    { "paths": ["apps/web"], "gates": ["npm run lint -w web"], "reviewers": ["project"] },
    { "paths": ["backend"], "gates": ["make -C backend test"], "dodFiles": [".grok/dod/backend.md"] }
  ]
}
```

| キー | ルート直下 (repo-wide) | `scopes[]` 要素内 |
|---|---|---|
| `baseBranch` / `trustCI` | 可 | **禁止** — 記載があれば設定エラーとして実行せず停止・報告する |
| `gates` / `reviewers` / `dodFiles` | 可 (グローバル既定) | 可 (マッチ時にグローバルへ**追加** union) |
| `paths` | — | **必須**・非空のパス配列 (リポジトリ相対 POSIX) |

全フィールド任意。`scopes` の無いファイルはフラット形式として従来どおり動く。

### 二段階解決

**① 起動時 (最初の試行の冒頭で 1 回)** — repo-wide のみ解決する:

| 項目 | 設定ファイル (ルート直下) | 自動導出 (設定に無い場合) |
|---|---|---|
| repo slug | — | `gh repo view --json nameWithOwner -q .nameWithOwner` (失敗時は `git remote get-url origin` から導出) |
| ベースブランチ | `baseBranch` | `gh repo view --json defaultBranchRef -q .defaultBranchRef.name` |
| CI の扱い | `trustCI` (既定 `true`) | `true`: PR 作成後に `gh pr checks` を確認し、失敗があれば修正対象として Step 3 に戻す。`false`: `gh pr checks` は一切見ない (CI がメンテされていないリポジトリ向け) |
| グローバル既定の gates / reviewers / dodFiles | `gates` / `reviewers` / `dodFiles` | (② と補足を参照。reviewers の最終既定は `["project", "adversarial"]`) |

**② ゲート実行直前・レビュアー起動直前 (Step 3 のゲート / Step 5 のたびに再解決)** — 変更ファイル集合から scope を解決する:

1. 変更ファイル集合 = 以下の和集合 (rename は新パス側を採る):
   ```bash
   git diff --name-only <base>...HEAD          # コミット済み
   git diff --name-only --cached               # staged
   git diff --name-only                        # unstaged
   git ls-files --others --exclude-standard    # untracked
   ```
2. 各 `scopes[]` 要素は、変更ファイルのいずれかが `paths` のいずれかに **prefix マッチ**すれば採用
3. 実行する gates / reviewers / dodFiles = ルートのグローバル既定 → 採用 scope の配列 (`scopes` の記載順) を**この順で連結**し、**文字列完全一致で dedupe (初出順保持)**
4. 結果が空 (グローバルも scope も無し) なら従来の自動導出: リポジトリルートの `package.json` の scripts に `type-check` / `lint` / `test` があるものを `npm run <name>` で実行 (`test` はテストファイルが存在する場合のみ)。それも無ければ**ゲート無し**として続行し、最終報告に明記

**prefix マッチ規則 (誤マッチ防止・厳守)**:

- `paths` 要素とファイルパスはリポジトリ相対 POSIX 形式に正規化する: 先頭 `./` を除去、末尾 `/` を除去。絶対パス・`..` 含み・空文字は設定エラーとして停止
- マッチ条件: `file == prefix` **または** `file` が `prefix + "/"` で始まる (ディレクトリ境界)。例: `paths: ["apps/web"]` は `apps/web/index.ts` にマッチし、`apps/web-old/x.ts` には**マッチしない**

### 最終報告への明記 (provenance)

- `config_source`: `workflow-grok` / `workflow-cc` / `auto-derive` のいずれか
- 採用された scope (あれば) と、それにより実行された gates / reviewers
- 旧 `.claude/workflow.json` を検出した場合はリネーム案内

### ゲート解決の補足

- **モノレポ**: サブプロジェクトごとにゲートが違う場合は設定ファイルの `scopes[]` で宣言すること (自動導出はリポジトリルートの `package.json` しか見ない。アプリ本体がサブディレクトリにある場合、宣言が無いと「ゲート無し」に解決される)
- **「ゲート無し」に解決されても**、AGENTS.md / CLAUDE.md がコード品質チェック (formatter / linter / 静的解析 / テスト) の実行方法を規定している場合は、それをローカルゲートとして扱い必ず pass させる (CI と同一チェックであることが多い)

## 成功条件 (全部満たしたら success を返す)

以下を**全て**客観的に確認できたときのみ完了とみなす:

- [ ] 該当 Issue 用の feature ブランチが存在し、push 済み
- [ ] PR が作成済み (`gh pr list --head <branch>` で 1 件以上)
- [ ] **解決済みローカルゲートがすべて pass** (ゲート無しの場合はこの項目を skip し最終報告に明記)
- [ ] 最初の PR 作成前に `/simplify` (code-simplifier plugin) を実行済み (利用不可 / docs-only で skip した場合はその旨を最終報告に明記)
- [ ] 最初の PR 作成前に `/security-review` を実行済みで、**HIGH / MEDIUM の未対応指摘が 0 件** (利用不可 / docs-only で skip した場合はその旨を最終報告に明記)
- [ ] `trustCI` が true の場合: `gh pr checks` に失敗が無い
- [ ] Step 5 のレビューを最新 HEAD に対して実行済みで (初回ラウンドはフル実行、2 回目以降は差分照合モードで可)、**(a) project レビューの must-fix (信頼度 ≥80) の未対応指摘が 0 件、(b) security HIGH / MEDIUM の未対応指摘が 0 件、(c) 外部レビュアー (codex / claude) / adversarial レビューの指摘のうち採用した分の未対応が 0 件** (advisory (60-79) は無視可、ただし最終報告に件数を残す。純 docs / コメントのみの PR は scope 外で skip 可、その場合は最終報告に "skipped: docs only" と記載)。run-epic 子は Step 5 をスキップし、親がレビューする
- [ ] Step 6 の項目を満たす最終報告を準備済み (PR URL 含む)

## アルゴリズム (内部ループ)

```
attempts = 0
max_attempts = 10

while attempts < max_attempts:
    attempts += 1

    # Step 0: 現在地の自己診断 (毎試行必ず先頭から)
    diagnose()

    # 成功条件チェック
    if all_success_conditions_met():
        return success(pr_url, summary, attempts)

    # 残作業の特定 (Step 0 の結果から判断)
    next_step = determine_next_step()

    # 該当 step を1ステップ分だけ進める
    execute(next_step)

    # ループ先頭へ戻り、最新状態で再判定
    continue

# max 試行に達した
return failure("max attempts reached", current_state, residual_tasks)
```

## 戻り値の形式 (run-epic 等の親へ)

成功時:

```
status: success
pr_url: https://github.com/<owner>/<repo>/pull/<番号>
summary:
  - 実装内容の要約 (PR を開かなくても変更の要点が分かる粒度)
attempts: <使用した試行回数>
```

失敗時 (max_attempts 到達 or 致命的エラー):

```
status: failure
reason: <理由 — ローカルゲート失敗内容 / max attempts reached の現在地 等>
pr_url: <作成済なら>
last_state: <Step 0 の最終診断結果>
attempts: <使用した試行回数>
```

直接起動 (main thread) の場合は、上記の代わりに Step 6 の最終報告をユーザーに提示する。

## PROGRESS.md との連携

- **直接起動時**: リポジトリルートに `PROGRESS.md` が存在すれば、Step 0 の初回に「現在地」を上書きしてから着手する (作業中 Issue / ブランチ / 状態 / 次の一手)。コミットや PR 作成後にフックから更新要求が来たら素直に従う。書いてよいのは **git / issue に無い情報だけ**: plan との乖離・失敗アプローチと理由・ハマりどころ・次の一手
- **run-epic 経由 (worktree 子)**: **PROGRESS.md には一切触れない** (作成も更新もしない)。gitignored のため worktree には存在せず、フックも発火しない。進捗は親セッションが EPIC issue のチェックボックスと親自身の PROGRESS.md に集約する

## イデンポテント実行手順 (各試行で先頭から実行)

### Step 0: 現在地の自己診断

毎試行、以下を確認してから動く:

```
gh issue view <N> --json number,title,labels,state
git rev-parse --abbrev-ref HEAD
git log --oneline -5
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --json number,url,state,headRefName
```

判定:

- ブランチがベースブランチ (または `main` / `master` 等の保護ブランチ) のままなら → Step 1
- feature ブランチにいるが PR 未作成なら → Step 3.5 (simplify 未実施の場合) → Step 3.6 (security-review 未完了の場合) → Step 4
- ローカルゲートが未通過なら → Step 3 (修正)
- `trustCI` が true で `gh pr checks` に失敗があるなら → Step 3 (修正)
- PR があり ローカルゲート通過済みだがレビュー未実施なら → Step 5 (レビュー)
- PR があり レビュー指摘あり (`must-fix ≥80` / `security HIGH/MEDIUM` / 採用済み外部指摘) なら → Step 3 (修正)
- すべて満たすなら → success を return

### Step 1: ブランチ準備 (初回のみ)

1. `gh issue view <N>` で本文・ラベル・関連 PR を確認
2. run-epic 経由の場合は親 EPIC issue の文脈 (関連 Sub-issue / 優先度) も確認する
3. ベースブランチは「リポジトリ設定の解決」で決めたもの (以下 `<base>`)
4. ブランチ名: `<type>/<短い kebab 要約>` または `<type>/<短い kebab 要約>-<番号>` 形式
   - `<type>` は `feat` / `fix` / `docs` / `chore` / `refactor` / `test`
   - 例: `feat/quiz-result-animation-42`, `fix/navigation-types-123`
   - リポジトリに既存のブランチ命名規約 (AGENTS.md / CLAUDE.md / git log から観察) があればそちらに従う
5. 既に同名ブランチがあれば checkout、なければ `git checkout -b <branch>` で作成

```bash
git fetch origin <base>
git checkout <base>
git pull origin <base>
git checkout -b <type>/<kebab-summary>
```

### Step 2: 参照ドキュメント (衝突時はこの順で優先)

1. `AGENTS.md`、無ければ `CLAUDE.md` (プロジェクト規約・Gotcha — 実装前に必ず読む)
2. `.grok/rules/`、無ければ `.claude/rules/` (存在すれば — coding-style / security / git-workflow / testing 等)
3. Issue 本文・コメント・関連 PR

リポジトリ固有の Gotcha は本スキルには書かない。**各リポジトリの AGENTS.md / CLAUDE.md の管轄**である。

### Step 3: 実装 or 修正

- 初回: Issue 要件に基づいて実装
- 2 回目以降: 前回レビュー指摘 or ローカルゲート失敗の修正
- テストが必要な変更 (ビジネスロジック・ユーティリティ関数) は実装と同時にテストを書く。テストツール・流儀はリポジトリの既存テストと AGENTS.md / CLAUDE.md / `.grok/rules/testing.md` / `.claude/rules/testing.md` に従う

**ローカルゲート (変更後は必ず全て pass するまで Step 4 に進まない)**:

「リポジトリ設定の解決」の **② をこの時点で再解決** (変更ファイル集合 → scope マッチ → union) し、得られたゲートを全て実行する。ゲート無しに解決されたリポジトリではこの確認を skip する (最終報告に明記)。

### Step 3.5: コード整理 (/simplify — 最初の PR 作成前に 1 回)

**最初の PR 作成前に必ず 1 回**実行する。**PR 作成後の修正ループでは再実行しない** (レビュー対応の diff を最小に保ち、採否検証を容易にするため)。

1. 前提: Step 3 の解決済みローカルゲートがすべて pass していること
2. code-simplifier plugin の `simplify` skill を **Skill ツール**で起動する (環境により `simplify` / `code-simplifier:simplify` の名で登録される)。対象は**本ブランチの変更ファイル (`git diff <base>...HEAD` の範囲) に限定**し、Issue スコープ外のファイルには触れさせない
3. simplify が変更を加えた場合: **解決済みローカルゲートを再実行** (「リポジトリ設定の解決」② を再解決) し、すべて pass するまで Step 4 に進まない。simplify 起因でゲートが落ちた場合は該当の整理を revert してよい (**機能維持が最優先** — simplify は機能を変えない整理だけが目的)
4. **skip 条件** (いずれかに該当したら skip し、最終報告に明記):
   - 純 docs / コメントのみの変更 (例: `*.md` のみ) → "simplify skipped: docs only"
   - **diff が小さい**: `git diff <base>...HEAD --shortstat` の追加 + 削除行の合計が **50 行未満** → "simplify skipped: small diff (<50 lines)" (simplify は diff の大小に関係なく起動コストが重く、小さい diff では得られる整理が軽微なため)
5. **可用性フォールバック**: `simplify` skill (および code-simplifier plugin) が環境に存在しない場合は**停止せず** Step 3.6 へ進み、最終報告に「simplify 利用不可」と明記する

### Step 3.6: セキュリティレビュー (/security-review — 最初の PR 作成前)

Step 3.5 の直後に実行する。**HIGH / MEDIUM の未対応指摘が 0 件になるまで PR を作成しない** (push 前に検出するのが目的 — PR 後の指摘は公開済みコードへの後追いになる)。

1. 公式 `/review` をセキュリティ観点で起動する (security-auditor persona の指示を読めるなら prepend する)。対象は現在のブランチの pending changes / ベースブランチとの diff。Claude の `/security-review` が環境にあればそれを使ってよい
2. 指摘の扱い: **HIGH / MEDIUM は Step 3 に戻って修正** → 解決済みゲート再実行 → **本 Step を再実行**して 0 件を確認してから Step 4 へ。**LOW** は判断に委ね、却下時は理由を最終報告に添える
3. **PR 作成後の修正ループでは再実行しない**。ただしレビュー対応でセキュリティに敏感な変更 (認証・認可・外部入力の扱い・シークレット・SQL / コマンド組み立て等) を加えた場合は再実行する
4. **skip 条件**: 純 docs / コメントのみの変更 (例: `*.md` のみ) は skip し、最終報告に "security-review skipped: docs only" と明記
5. **可用性フォールバック**: `/review` も `/security-review` も使えない場合は**停止せず** Step 4 へ進み、最終報告に「security-review 利用不可」と明記する
6. ⚠️ **レビューレポートを自分の最終応答にしない** (Step 5 の事故パターンと同じ罠)。review skill が return したら、応答を書かずに必ず次のツール呼び出し (HIGH/MEDIUM の修正 or Step 4 のコミット) を実行する

### Step 4: コミット → Push → PR

- **日本語**コミットメッセージ、Conventional Commits プレフィクス (`feat:` / `fix:` / `docs:` / `chore:` / `refactor:` / `test:`)。リポジトリの `git log` の既存流儀が異なる場合はそちらに合わせる
- 1 コミット = 1 論理変更
- co-author 行はセッション既定の指示 (harness からの指定) があればそれに従う。無ければ `Co-Authored-By: Grok <noreply@x.ai>`
- `git push origin <branch>` (`--no-verify` / `--no-gpg-sign` は禁止)
- PR 未作成なら、**Step 3.5 (/simplify) と Step 3.6 (/security-review・HIGH/MEDIUM 0 件) を通過済みであることを確認してから** `gh pr create --base <base>` で作成 (未実施なら該当 Step に戻る)。本文は**日本語**、テンプレ:
  ```
  ## Summary
  ## Test plan
  ## 関連
  ```
- 変更は最小限にする (Issue スコープ外の refactor・cleanup を混ぜない)
- **push / PR 作成が permission 設定で拒否された場合** (`.grok/config.toml` や `.claude/settings.json` の deny 等): **迂回禁止** (deny の回避・設定変更・bypass フラグはしない)。ローカルで完了できる残作業 (Step 3 のゲート・Step 5 のレビュー) は先に進めてよいが、最終的に `status: failure` で return し、reason に「push が permission で拒否された」ことと人間が実行すべきコマンド (`git push origin <branch>` / `gh pr create --base <base> ...`、PR 本文案込み) を明記する

```bash
git add <変更ファイル>
git commit -m "feat: 〇〇を実装"
git push origin <branch>
gh pr create --base <base> --title "<タイトル>" --body "$(cat <<'EOF'
## Summary
- 実装内容

## Test plan
- ローカル動作確認 / テスト実行結果

## 関連
Closes #<N>
EOF
)"
```

### Step 5: コードレビュー (マルチレビュアー対応)

本ステップの後には Step 6 (完了報告) が続く。レビューが return したら、そのレポートを最終応答にせず次のツール呼び出し (トリアージ → PR コメント投稿) に進む — review skill の出力フォーマット指示に応答が引きずられ、レポートを最終応答にして終了した例が過去 2 回ある (Skill 経路で現セッションから起動した場合に起きやすい)。

#### レビュアーの解決 (優先順)

1. 起動引数の明示指定: `review=codex,claude` (自然言語指定も同義。`grok` は無視)
2. 設定ファイルの `reviewers` (「リポジトリ設定の解決」② — グローバル既定 + 変更ファイルにマッチした scope の union)
3. 既定: `["project", "adversarial"]` (adversarial を外したいリポジトリは設定ファイルの `reviewers` で明示指定する — 引数 / 設定があれば既定は使われない)

#### レビューラウンドの方式 (初回フル / 2 回目以降は差分照合)

- **初回ラウンド**: 指定された全レビュアーをフル実行する (下記「各レビュアーの実行方法」)。実行時の `git rev-parse HEAD` を記録する
- **2 回目以降のラウンド (修正後の再レビュー)**: 全レビュアーの全量再実行は**しない** (同じ diff を何度も読ませるのはトークンの無駄):
  - 再実行するのは**前ラウンドで未対応指摘 (must-fix / security HIGH・MEDIUM / 採用した外部指摘) を出したレビュアーだけ**。指摘 0 件だったレビュアーは再実行しない
  - prompt に渡すのは「前ラウンドの該当指摘リスト」+「修正 diff (`git diff <前ラウンドの HEAD SHA>...HEAD`)」のみ。full diff と Issue 本文の再埋め込みはしない
  - 判定させるのは 2 点だけ: (a) 各指摘が解消されたか (b) 修正 diff 自体に新たな問題が無いか
  - ラウンドごとに実行時 HEAD SHA を記録し直す
  - **フル再実行に戻す例外**: 修正がレビュー済み範囲を大きく超えた場合 (目安: 修正 diff の行数が前ラウンドでレビューした diff の 5 割超)。この場合は初回と同じフル実行にする

#### 各レビュアーの実行方法 (フル実行の形)

**run-epic 子として動いているときは本セクションの spawn を行わない** (Grok はネスト不可)。親がレビューする。直接起動時も、指定された全レビュアーは**同一ターンで並列**に起動する。`project` と `adversarial` は同一メッセージ内の複数 `spawn_subagent` (同期)。`codex` / `claude` は同じターンの `run_terminal_command` (`background: true`)。先に返った 1 体の指摘で修正を始めない。

- **`project`**: `.grok/skills/code-review-project/` があればそれを使う。無ければ `.claude/skills/code-review-project/`。どちらも無ければ公式 `/review`。セキュリティレビューは Step 3.6 で済んでいるのでここでは再実行しない (レビュー対応でセキュリティに敏感な変更を加えた場合は Step 3.6 の規則に従い再実行)
- **`codex` / `claude`**: 下記「外部レビュアーの実行」で companion の `adversarial-review` を直接起動する。rescue agent は通さない
- **`grok`**: 無視する (本体が Grok。独立視点は `adversarial` が担う)
- **`adversarial`** (既定に含まれる): `spawn_subagent(subagent_type: "general-purpose")` で**実装とは独立したコンテキスト**の red-team レビューを起動する (実装した本人のコンテキストで自己批判させない — 自己整合バイアスで甘くなる)。prompt に埋め込む:
  - ローカル repo の絶対パス・レビュー対象ブランチ名・ベースブランチ名 (diff は `git diff <base>...<branch>` 等ローカル git で取らせる)
  - **Issue 本文の全文** (受け入れ条件込み)
  - 役割指定: 「**この変更は壊れていると仮定し、実際に壊れる具体的シナリオを探せ**。観点: 受け入れ条件を満たさない入力・状態 / 境界値 (空・0・巨大・不正型) / 並行・順序依存 / エラーパスでの状態・リソースの取りこぼし / 既存呼び出し元の後方互換。**再現手順または根拠となるコード行を示せない指摘は出すな** (『〜かもしれない』の羅列は禁止)。スタイル・好みには触れるな (simplify / project の担当)」
  - 出力形式の指定: 指摘ごとに「対象ファイル:行 / 壊れるシナリオ (入力・状態 → 期待 vs 実際) / 根拠 / 修正案」
  - セキュリティ脆弱性は Step 3.6 (/security-review) の担当 — adversarial は**機能の破壊**にフォーカスする (発見したら報告してよいが主目的にしない)

#### 外部レビュアーの実行 (companion を直接呼ぶ)

`codex` と `claude` は **rescue agent (`codex-grok:codex-rescue` / `claude-grok:claude-rescue`) を通さない**。転送役を挟むと、フラグの欠落・CLI を起動せず自分で答える代行・「CLI を起動せよ」という指示を相手が読んで CLI を入れ子起動する、が起きる。依頼文に CLI の起動手順を書かない。

1. **companion の場所を解決する** (エンジンごとに 1 回)。`<name>` は `codex-grok` または `claude-grok`:
   ```bash
   P=$(grok plugin list --json | jq -r --arg n <name> '[.[] | select(.name == $n and .status == "installed")][0].path // empty')
   ```
   空なら `<engine>: 利用不可 (<name> 未インストール)` として続行する
2. **起動する**。レビューは foreground の待ちを超えるので `run_terminal_command` の `background: true`。出力先は `mktemp -d` の `<out>`。スクリプト名は `codex-companion.mjs` / `claude-companion.mjs`:
   ```bash
   node "$P/scripts/<engine>-companion.mjs" adversarial-review \
     --cwd <リポジトリの絶対パス> --base <比較基準> [--model <モデル>] --json \
     "<フォーカス文>" > <out>/<engine>.json 2> <out>/<engine>.log
   ```
   - `--base`: フルラウンドは `<base>`、差分照合ラウンドは前ラウンドの HEAD SHA
   - `--model`: `codex-model=` / `claude-model=` の値。省略または `=default` なら付けない。明示したモデルで起動できなければ別モデルに差し替えず `<engine>: 利用不可` として続行する
   - フォーカス文: フルラウンドは「Issue #<N> の受け入れ条件に照らしてレビューせよ」+ Issue 本文。差分照合ラウンドは「前ラウンドの指摘が解消されたか、修正 diff 自体に新たな問題が無いか」+ 採用済み指摘リスト。**CLI の起動方法は書かない** (companion が diff をローカル git から集める。GitHub は参照しない)
3. **結果を読む**。`<out>/<engine>.json` の `.grok.status == 0` かつ `.parseError == null` なら成功 (状態フィールド名は companion 側の歴史的なキー名)。`.result.verdict` / `.result.summary` / `.result.findings[]` を使う。それ以外は `<engine>: 利用不可 (<log の要点>)`。読み終えたら `rm -f <out>/<engine>.json <out>/<engine>.log && rmdir <out>` (`rm -rf` は使わない)

**可用性フォールバック**: プラグインが無い、または companion が失敗したら、**停止せず**「<name> は利用不可、残りで続行」として最終報告に明記する。

#### 採否判定とゲート

- project レビューの指摘: **must-fix (信頼度 ≥80)** と **security HIGH / MEDIUM** は Step 3 に戻って対応 (次の試行で修正)。security LOW は判断に委ね、却下時は理由を最終報告に添える。**advisory (信頼度 60-79)** は却下可、ただし件数と内容を最終報告に添える
- 外部レビュアー (codex / claude) と adversarial の指摘は、**1 件ずつトリアージ**して「採用 (must-fix 扱い → Step 3 で対応) / 却下 (理由必須)」に振り分ける。companion の `confidence` は 0〜1 の参考値で、project の閾値とは対応しない。adversarial の指摘は**再現シナリオの具体性**で判定する (シナリオが実際に成立するかをコードで確認してから採否を決める)
- レビュー結果 (却下した指摘とその理由を含む) を **PR コメントとして投稿** (`gh pr comment <PR> --body "..."`) — 人間が後から採否判定を検証できるように。PR が未作成の場合 (push 拒否等) は同内容を最終報告に記載する
- 純 docs / コメントのみの PR (例: `*.md` のみの変更) は **scope 外で skip 可**、最終報告に「review skipped: docs only」と明記
- **must-fix + security HIGH/MEDIUM + 採用済み外部指摘 が全て 0 件 (skip 含む) を確認できたら、即座に Step 6 へ進む。ここで親へ return しない**

### Step 6: 完了報告 (success を return する直前)

⚠️ **直接起動 vs run-epic 経由で出口が異なる**:

- **直接起動 (`/implement-issue 42`)**: 成功条件を満たした時点で本ステップを実行 → ユーザーへ最終報告。merge / close は**ユーザー判断** (本 skill のスコープ外)
- **run-epic 経由**: 成功条件を満たしただけでは**まだ親に return してはいけない**。run-epic の prompt template が要求する追加 step (PR 状態確認 + ローカルゲート最終確認 + 自己診断) を続けて実行してから親に return する。**merge / Issue close は行わない** (merge は人間判断)

最終報告に以下を含める:

- PR URL
- 実装内容の要約 (箇条書き。PR を開かなくても変更の要点が分かる粒度で)
- ローカルゲートの実行結果 (各ゲートの pass/skip。ゲート無しならその旨)
- `/simplify` の結果 (適用された整理の概要 / "simplify skipped: docs only" / 「simplify 利用不可」のいずれか)
- `/security-review` の結果 (HIGH / MEDIUM / LOW の件数と対応状況・LOW 却下の理由 / "security-review skipped: docs only" / 「security-review 利用不可」のいずれか)
- `trustCI` の扱い (true なら `gh pr checks` の結果、false なら「CI 不参照」)
- レビュアーごとの指摘件数と採否。例: `project: must-fix 0・advisory 2 / adversarial: 2件 (採用1・却下1) / codex: 3件 (採用1・却下2) / claude: 利用不可`
- 外部レビュアーのモデル。例: `codex: CLI 既定` / `claude: claude-model=sonnet`。明示したモデルで起動できなかった場合はここに書く
- レビューのラウンド数と方式 (例: `フル 1 + 差分照合 2`)
- 却下した指摘の理由 (簡潔に列挙)
- 試行回数 (attempts)

直接起動の場合のみ、最終応答後にセッションの学びを AGENTS.md へ残す作業があればリポジトリの流儀に従う。run-epic 経由の場合は親側で集約するため子はスキップ。

## 厳守事項

- **ベースブランチと保護ブランチ (`main` / `master` / `dev` 等) への直接コミット・マージは禁止**。必ず PR 経由
- **`--no-verify` / `--no-gpg-sign` などの bypass フラグは使わない**
- **`.env` / API キー / 証明書をコミットしない**
- **security 系 rules 違反の指摘は最優先で直す**
- **変更は Issue スコープ最小限**。周辺の整理整頓を PR に混ぜない
- **`max_attempts = 10` を超えたら必ず failure を return**。無限ループは禁止 (リトライ判断は呼び出し元に委ねる)
- **解決済みローカルゲートは必ず pass してから PR を作成・更新する**

## 起動例

直接:
```
/implement-issue 42
/implement-issue 42 review=codex
/implement-issue 42 review=claude claude-model=sonnet
```

run-epic 経由 (推奨、main context 保護):
```
/run-epic 252
```
→ run-epic が EPIC #252 の OPEN な Sub-issue ごとに `spawn_subagent({isolation: "worktree"})` で spawn し、子が本スキルのアルゴリズムを実行 (レビューは親)
