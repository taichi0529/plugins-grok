---
name: run-epic
description: EPIC issue 番号を渡すと、その Sub-issues を GitHub API で取得し、未クローズの子 issue を子エージェント (general-purpose, isolation=worktree) に委譲して実装するオーケストレーター skill (リポジトリ非依存)。既定は直列。parallel=N 指定時は依存宣言 (depends on / Target scope) の機械解析で独立と判定できた子だけを wave 並列する。各子は実装 + ローカルゲート + PR 作成まで担い、レビューは親が行う (Grok はサブエージェントをネストできない)。自動 merge はしない (merge は人間)。「EPIC #252 を回して」「run epic 252」「EPIC の sub-issue を全部実装」などのリクエスト時に使用。引数は EPIC 番号 + 任意の parallel= / model= 指定 (例 252 parallel=2 model=grok-4)。
---

# Run-Epic Skill (EPIC Sub-issue オーケストレーション・汎用)

EPIC issue にぶら下がる **Sub-issues を実装するオーケストレーター**。ローカルの todo ファイルではなく、**GitHub の Sub-issues API を唯一の作業リスト**として扱う。未クローズの子 issue を子エージェントへ委譲し、各 issue を「実装 → ローカルゲート pass → PR 作成」まで完走させる。

実行順は**既定で直列**。`parallel=N` (N ≥ 2) を指定したときだけ、「独立性トリアージ」(後述) で機械的に独立と判定できた子 issue を同一バッチで並列実行する。

> 進捗管理は GitHub の Sub-issues 機能が自動で行う (親 EPIC の進捗バー)。PR が merge され子 issue が close されると進捗バーが自動更新される。本スキルはローカル todo ファイルを持たない。

引数: `$ARGUMENTS`

- 第 1 トークン: EPIC の issue 番号 (例: `252`, `#252`)
- 任意: `parallel=<正の整数>` (例: `252 parallel=2`)。自然言語での指定 (「2 並列で」) も同義に解釈する
  - 省略時は `parallel=1` (= 直列実行。独立性トリアージはスキップする)
  - 0 以下・非数値が指定された場合は実行せずエラーを報告して停止
  - 推奨上限は 3 (子 1 体 = implement-issue 最大 10 試行 + レビューで重い。コストとマシン負荷に注意)
- 任意: `model=<モデル名>` (例: `252 model=grok-4`)。自然言語での指定 (「子はこのモデルで」) も同義に解釈する。`parallel=` と順不同で併用可
  - **子エージェント (implement-issue 実行体) の spawn にだけ適用する**。親自身・1b 検証・外部レビュアー (codex / claude) には影響しない
  - 省略時は指定なし = 子はセッションモデルを継承
  - 値の allowlist は SKILL 側に持たない (利用可能なモデル名は harness 側の事実で環境ごとに変わる)。値が空なら実行せずエラーを報告して停止。spawn が拒否された場合は**別モデルへフォールバックせず**「model=<値> が環境で利用不可」として停止・報告する
  - 設定ファイルには入れない — `parallel` と同じ理由 (モデル選択は個人・コスト都合)
- 任意: `codex-model=<モデル名>` / `claude-model=<モデル名>`。親が 1b のあとで回す Step 5 の companion に渡す。子 prompt には埋め込まない (子はレビューしない)。解釈は implement-issue の引数説明が正。省略時は各 CLI の既定

## リポジトリ設定の解決 (起動時に 1 回)

implement-issue skill の「リポジトリ設定の解決」(正典) と同じ規則で解決する (`.grok/workflow-grok.json` → `.claude/workflow-cc.json` → 無ければ自動導出。旧 `.claude/workflow.json` は読まない):

- **repo slug**: `gh repo view --json nameWithOwner -q .nameWithOwner`
- **ベースブランチ** (以下 `<base>`): `baseBranch` → 無ければ `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`
- **trustCI** (既定 `true`): `false` のとき `gh pr checks` を一切判定基準にしない (CI がメンテされていないリポジトリ向け)。true でも**自動 merge はしない** — merge は常に人間の判断
- **ローカルゲート**: 実装中は子が implement-issue skill の解決規則に従って解決・実行する。親が関与するのは 1b の検証時のみ (PR の変更ファイルから同じ規則で再解決して実行)

**implement-issue SKILL.md のパス解決** (子に Read させるため親が起動時に解決して絶対パスで埋め込む):

1. `.grok/skills/implement-issue/SKILL.md` があればそれ (リポジトリ固有版を優先)
2. 無ければ `.claude/skills/implement-issue/SKILL.md`
3. どちらも無ければ本 plugin の `skills/implement-issue/SKILL.md` (本 SKILL.md の隣。場所が不明なら `ls "$(dirname <本SKILL.mdのパス>)/../implement-issue/SKILL.md"` で確認)

## 実行方式の決定: worktree か main checkout か (起動時に 1 回判定)

子の isolation は**原則 `"worktree"`**。ただし worktree 内でローカルゲートが実行できない環境では成立しない。起動時に判定する:

- **worktree が成立する条件**: ゲートのツールチェーン (linter / 静的解析 / テストランナー) がホストにあり worktree 内で動く、または worktree 単体でセットアップ可能
- **成立しない例 (実測)**: PHP ツールチェーンが docker コンテナ内にしか無く、compose がメイン checkout のディレクトリを固定 volume mount している場合 — worktree のコードはコンテナから見えず、テスト・静的解析が一切実行できない
- 成立しない場合は **main checkout 直列実行に切り替える** (isolation なし。直列なので conflict しない)。切り替えたことを最終報告に明記する。子には「main checkout で直接作業。終了前に `git checkout <base>` で戻す」を指示する
- **main checkout モードでは並列不可**: `parallel` に 2 以上が指定されていても、**警告を最終報告に残して 1 に落とし**直列実行する (単一 working tree は本物のリソース共有であり並列できない)

## 独立性トリアージと wave 分割 (parallel ≥ 2 のときだけ実行)

`parallel=1` (既定) では本セクションを**丸ごとスキップ**し、Sub-issues API 順の直列実行とする。

### 依存とスコープの機械解析 (LLM による内容予測は行わない)

各 OPEN 子 issue の本文から以下**だけ**を解析する。**本文の散文から「触りそうなファイル」を推測して判定に使うことは禁止** (モデルごとに結果が変わり、再現可能なオーケストレーションにならない):

1. **明示依存 (コード依存)**: 次の 2 つの union
   - `depends on:` 行 (大文字小文字非区別)。例: `depends on: #12, #34` / 依存無しの明示は `depends on: none`
   - legacy 互換: `## Blocked by` セクション配下の `#\d+` 全部
2. **Target scope**: `## Target scope` セクションの次の非空行 1 行 (カンマ区切りで複数可)。**HTML コメント (`<!-- ... -->`) は行内・単独行とも除去してから判定し、コメントだけの行は非空行とみなさない**。パスの正規化と prefix 判定は implement-issue の「prefix マッチ規則」に従う

解析の検証 (spawn 前に必ず実施):

- **自己依存・閉路** → 実行せず、該当の辺一覧を報告して停止
- **依存先が OPEN 子集合の外** → その issue が closed または対応 PR が merged なら「満たされた依存」とみなす。存在しない番号・EPIC 外への参照は辺として無視し、警告を最終報告に残す
- **宣言が無い issue はエラーにしない** (legacy 入力として正当。下記の判定で保守的に直列へ落ちる)

### ready-set (今回の実行で扱う子)

run-epic は自動 merge しないため、**同一実行内で前の子の成果 (未 merge の PR) を後の子が参照することはできない**。したがって:

- 明示依存の依存先がすべて「満たされた」(issue が closed、または対応 PR が merged) 子だけが ready
- 依存先が未満足 (merge 待ち PR あり / 未実装) の子は**今回は処理しない**。「#N は #M の merge 待ち」として最終報告と EPIC サマリに記載する。人間が merge した後に再実行すれば続きから処理される

### 並列可否の判定 (ready-set 内のペアごと)

- **並列可**: 相互に明示依存が無く、**かつ両方に Target scope 宣言があり、どの scope ペアも異なり・一方が他方の prefix でない**
- それ以外 (どちらかに scope 宣言が無い / scope が重なる) は**保守的に直列** (Sub-issues API 順を保つ)

### バッチ分割 (決定的アルゴリズム)

ready-set を Sub-issues API 順に走査して次の規則でバッチ列を作る:

```
batches = [], current = []
for issue in ready_set (API 順):
    if len(current) < parallel かつ current の全 issue と「並列可」:
        current に追加
    else:
        current を batches に確定し、新しい current = [issue]
最後の current を batches に確定
```

- バッチ内 = 同時 spawn する集合 (最大 `parallel` 個)。バッチ間 = 直列
- 分割結果 (バッチ構成・並列化したペアの根拠・直列化した理由・merge 待ちの子) を最終報告と EPIC サマリに明記する

## PROGRESS.md との連携 (D11)

- **worktree 子は PROGRESS.md に一切触れない** (作成も更新もしない)。PROGRESS.md は gitignored のため worktree には存在せず、フックも発火しない — この分離は設計であり、崩さない (単一状態ファイルへの並行書き込みは conflict の温床)
- **main checkout 直列で動かす子は例外**: PROGRESS.md が存在するためフック (コミット / PR 作成検知) が発火する。子には「フックの更新要求には素直に従う」を指示する (直列なので競合しない)
- **親 (このセッション) が集約する**: バッチ完了 (= バッチ内全子の 1b 検証。parallel=1 なら子 1 件) ごとに、リポジトリルートに PROGRESS.md が存在すれば「現在地」を上書き (処理中の EPIC / 完了済み子 / 残りバッチ / 次の一手) し、「ログ」に子ごとの結果 1 エントリ (PR 番号・plan差分・子が報告した想定外) を追記する

## あなた (オーケストレーター親) のタスク

引数の EPIC 番号の Sub-issues のうち **OPEN な子 issue** を、Sub-issues API が返す順 (= 追加順 = 通常は優先度順) を基本にバッチへ分割し (`parallel=1` なら 1 件 = 1 バッチ)、バッチ単位で子エージェントに委譲して ready な全子 issue の PR 作成まで実行する。

## 成功条件 (全部満たしたら完了)

- [ ] EPIC `#$ARGUMENTS` の **ready-set に入った** OPEN な Sub-issues すべてについて PR が作成済み (`gh pr list` で確認)。依存 merge 待ちで持ち越した子は「未処理 + 理由」として最終報告に列挙済み
- [ ] 各子 issue の PR が OPEN かつローカルゲート pass 済み
- [ ] EPIC issue にサマリコメント (作成 PR 一覧 / merge 待ち) を投稿済み
- [ ] ユーザーへ最終報告 (実装 issue 数 / 全 PR URL リスト / 想定外メモ / merge 待ち PR 一覧) を提示済み

## 動作モデル

### Step 0: 起動時の状態確認

1. EPIC の妥当性確認:
   ```bash
   gh issue view $ARGUMENTS --json number,title,state,labels
   ```
   - `state` が `OPEN` でない / `epic` ラベルが無い場合は、ユーザーに「指定された #$ARGUMENTS は EPIC ではない可能性がある。続行するか」と確認する
2. Sub-issues を取得 (これが作業リスト):
   ```bash
   gh api /repos/<owner>/<repo>/issues/$ARGUMENTS/sub_issues \
     --jq '.[] | {number, title, state}'
   ```
   - **`state == "open"` の子 issue だけ**を、API が返す順 (先頭から) にリスト化する
   - closed の子はスキップ (= 既に対応済み)
   - **OPEN でも、対応する OPEN な PR が既に存在する子は再分類する** (再実行時の二重実装防止 + 失敗 PR の取りこぼし防止): 各 OPEN 子について `gh pr list --state open --search "Closes #<N>" --json number,url,headRefName` を確認し、該当 PR があれば **1b と同じ基準で客観検証**する (`trustCI` が true なら `gh pr checks` の合否、それ以外は PR head をチェックアウトして解決済みゲートを再実行):
     - **verified-ready** (PR OPEN + checks/ゲート合格) → 作業リストから除外し「PR #<M> 作成済み・merge 待ち」として最終報告に含める
     - **検証 NG** (checks 失敗・ゲート失敗) → **作業リストに残し、その PR の `headRefName` を記録する** (1a でその子の `<assigned-branch>` として渡し、既存ブランチ・既存 PR を再利用して修正させる)。前回検証 NG のまま停止した子を「merge 待ち」と誤分類して skip しないため。issue state だけを見て再委譲すると merge 待ちの子に重複ブランチ・重複 PR を作ってしまう点は従来どおり
3. リストが空 → 「EPIC #$ARGUMENTS の OPEN な Sub-issues は無し (全て対応済 or 子未登録)」と報告して終了
4. 親セッションの git 状態を確認:
   - `git status` (working tree が clean であること。gitignored な PROGRESS.md 等は無視してよい)
   - `git rev-parse --abbrev-ref HEAD` が `<base>` 上にあること
   - dirty / 別ブランチにいる場合はユーザーに「親 cwd を <base> の clean 状態にしてから再実行してください」と報告して終了
5. リポジトリルートに PROGRESS.md があれば「現在地」を上書きしてから開始 (EPIC 番号 / 処理予定の子リスト / 次の一手)

### Step 1: バッチを順に処理

ready-set のバッチ列 (`parallel=1` なら「OPEN 子 issue 1 件 = 1 バッチ」) を先頭から取り出して、以下を繰り返す:

#### 1a. 子エージェント spawn (バッチ単位)

バッチ内の全子を**同一メッセージ内の複数 `spawn_subagent` 呼び出し (同期)** で同時に起動する。**background 起動 + 後追い返信方式は使わない**。

spawn 前にバッチ共通の準備を親が行う:

- `BASE_SHA=$(git rev-parse origin/<base>)` を捕捉する (バッチ内全子の分岐点を固定し、バッチ実行中に base が進んだ場合も検出できるようにする)
- 子ごとに**親が一意なブランチ名を割り当てる**: 新規の子は `<type>/issue-<N>-<短い kebab 要約>` (issue 番号入り — 並列時のブランチ名衝突を構造的に防ぐ)。**Step 0 で検証 NG と再分類された子には新しいスラッグを生成せず、記録済みの既存 PR の `headRefName` をそのまま `<assigned-branch>` として渡す** (重複ブランチ・重複 PR 防止)

各 `spawn_subagent` のパラメタ:

- `subagent_type`: `general-purpose`
- `isolation`: `"worktree"` (必須 — 親の cwd を汚さない)
- `model`: `model=` 引数の指定時のみその値を渡す。未指定なら**このパラメタ自体を付与しない** (= 子はセッションモデルを継承)
- `description`: `Issue #<N> 実装 + ローカルゲート pass + PR 作成`
- `prompt`: 下記テンプレ (`<N>` = Sub-issue 番号、`<base>` = ベースブランチ、`<SKILL_PATH>` = 親が解決した implement-issue SKILL.md の絶対パス、`<assigned-branch>` = 親が割り当てたブランチ名、`<BASE_SHA>` = 捕捉した base SHA、に置換)

```
あなたはこのリポジトリの実装エージェントです。
GitHub Issue #<N> を実装し、PR 作成 → ローカルゲート pass まで完走させて、親に構造化結果を返してください。

## 終了条件

親への return は、Phase B で次の 2 点を実 shell で確認した後にしてください (親はこの結果を再検証し、未確認の success は差し戻されます):

1. `gh pr list --head <branch> --json number,url,state` で PR が OPEN 状態で存在する
2. ローカルゲート (implement-issue SKILL.md の解決規則で決まったもの) が全て pass している

**レビュー (Step 5 / spawn_subagent / /review) は行わない。** Grok はサブエージェントをネストできない。レビューは親が行う。

## 禁止事項

- **PROGRESS.md に触れない** (作成も更新もしない。進捗集約は親の仕事)
- /implement-issue や他のワークフロー系 slash command を呼ばない (アルゴリズム本体を自分のコンテキストで実行する。二重 spawn 回避)
- **spawn_subagent を呼ばない** (ネスト不可)
- merge / issue close をしない
- push / PR 作成が permission で拒否された場合は迂回せず、implement-issue SKILL.md の該当分岐に従って failure を返す

## 実行手順 (順番厳守)

**Phase A — 実装**

1. ブランチ準備 (親の指定に厳密に従う):
   git fetch origin <base>
   git checkout -b <assigned-branch> <BASE_SHA>
   ブランチ名は必ず <assigned-branch> を使うこと (自分で命名しない — 並列実行時の衝突防止)。既に同名ブランチが存在する場合 (検証 NG の再実行) は新規作成せず、git fetch origin <assigned-branch> → git checkout <assigned-branch> で既存ブランチを checkout し、既存 PR を再利用して修正の続きから作業する。

2. <SKILL_PATH> を Read して、その「リポジトリ設定の解決」「アルゴリズム」「イデンポテント実行手順」セクションに従って Issue #<N> を実装する。
   - 内部ループで最大 10 試行。各試行で状態自己診断 → 次の1歩 → 次の試行
   - ローカルゲートが全て pass するたびに、その時点の `git rev-parse HEAD` を記録しておく (Phase B の skip 判定に使う)
   - リポジトリの AGENTS.md / CLAUDE.md / .grok/rules/ / .claude/rules/ を必ず読んで従う
   - PR 本文には `Closes #<N>` を含め、merge 時に Sub-issue が自動 close → EPIC 進捗バーが進むようにする
   - Step 5 (レビュー spawn) はスキップする。simplify / security-review は環境にあれば実行してよい (skill 呼び出しであり spawn ではない)。無ければ skip して報告
   - implement-issue が "success" 相当になったら Phase B に進む
   - max_attempts に達したら failure を返す

**Phase B — PR 状態確認 + 自己診断 (Phase A 完了後に必ず連続実行)**

3. `gh pr list --head <branch> --json number,url,state,headRefName` で PR を取得。存在しない or CLOSED/MERGED なら failure
4. ローカルゲートの最終確認: 現在の `git rev-parse HEAD` が**最後に全ゲート pass した時点の記録 SHA と同一**、かつ `git status --porcelain` が空なら、再実行を **skip** して「SHA 一致 (<SHA>) により再実行省略」を合格証拠として親への報告に含める。SHA 不一致 / working tree が dirty なら解決済みゲートを全て再実行。いずれかが失敗したら failure
5. 最終自己診断 (親へ return する直前):
   - `gh pr list --head <branch> --json number,url,state` を実 shell 実行 → PR が OPEN であることを確認
   - ローカルゲートの合格を確認 (4 の再実行結果、または SHA 一致による省略)
   - 両方確認できるまで return しない

**Phase C — 親への構造化応答 (上記 5 を pass した後にだけ実行)**

6. 親に以下を構造化して返す:
   - status: "success" or "failure"
   - failure の場合は理由 (ローカルゲート失敗内容 / implement-issue が返した failure reason 等)
   - PR 番号と URL (success のとき)
   - 主な変更点 2-3 行
   - implement-issue が消費した試行回数 (attempts)
   - 想定外があれば 1-2 行

Phase B のゲート失敗 / max_attempts 到達 / その他停止すべき問題 (permission 拒否等) に遭遇したら、親に "failure: <理由>" で返してください。Phase A 中のゲート失敗は implement-issue の内部ループ (Step 3 での修正) で扱い、それ以外のリトライや回避策は子側で行わず親が判断します。

Phase B を skip して「success」を返さないでください。PR OPEN とゲート合格を実 shell で確認してから return します。
```

#### 1b. 子の戻り値を**親側で検証** (子の success 文字列を信用しない)

子が Phase B (PR 状態確認) を skip して「success」と称して return した例がある。親側で必ず実 shell 検証する。

**バッチの全子が return してから、1 件ずつ直列に検証する** (検証を並列にしない — 親 cwd と一時 worktree の操作が競合するため)。

子から戻ってきたら、`status` の文字列とは無関係に以下を毎回実行:

1. 子が報告した PR 番号を取得 (報告に無ければ `gh pr list --search "Closes #<N>" --state open --json number,state,url,headRefName`)
2. `gh pr view <PR> --json state,headRefName` を実 shell 実行 → `"state":"OPEN"` を目視確認
3. `trustCI` が true の場合のみ: `gh pr checks <PR>` を確認し、失敗があれば検証 NG として扱う (watch で長時間待たない。pending は NG にしない)
4. **ローカルゲートの客観確認** (子の「ゲート pass」自己申告は証拠にしない):
   - 実行するゲートは implement-issue の解決規則 ② に従い、**PR の変更ファイル (`gh pr diff <PR> --name-only`) から scope を再解決**して決める
   - `trustCI` が true で、`gh pr checks <PR>` にローカルゲート相当のジョブ (lint / テスト等) が含まれて全て pass している場合は、それを合格証拠としてよい
   - それ以外は親が PR head をチェックアウトして解決済みゲートを再実行する:
     - worktree モード: `git fetch origin <headRef>` → `git worktree add ../run-epic-verify-pr<PR番号> origin/<headRef>` (**PR 番号入りの一意パス** — バッチ内複数 PR の検証でも衝突しない) → 一時 worktree 内でゲート実行 → `git worktree remove ../run-epic-verify-pr<PR番号>` (ゲートが失敗しても必ず remove を試み、除去できなければ最終報告に明記)
     - main checkout 直列モード: `gh pr checkout <PR>` → ゲート実行 → `git checkout <base>` で戻す
   - いずれかのゲートが失敗したら検証 NG (PR が OPEN でも success 扱いにしない)

**判定**:

- **検証 OK (PR OPEN かつゲート合格)** → **親が implement-issue Step 5 相当のレビューを本体セッションで実行** (project + adversarial。`spawn_subagent` は親だけが呼ぶ)。must-fix / 採用した指摘があれば、同じ子を `resume_from` で再開して修正させる → 再度 1b。指摘 0 件なら Step 1c へ。merge はユーザーが別途行う
- **検証 NG だが PR は存在する (ゲート失敗 or 状態不整合)** → 同じ子を `spawn_subagent` の `resume_from` で再開し Phase B 続行を指示する:
  - 内容: 「Phase B (PR 状態確認 + ローカルゲート最終確認 + 自己診断) を実行し、確認できたら return せよ」
  - 完了したら**再度この 1b の検証を実行**
  - **再検証も NG なら、ユーザーに「Issue #<N> で子が Phase B を完走できず手動介入要」と報告して停止** (再度 resume はせず、ループを避ける)
- **検証 NG で PR 不在 or 子が `status: "failure"` を明示** → 親側で停止:
  - EPIC / 子 issue の状態は変更しない (該当 Sub-issue は OPEN のまま残す)
  - **同一バッチで既に return している他の子の検証・記録 (1b〜1c) は完了させる** (並列時に他の子の成果を放置しない)。その後、**新しいバッチ / wave は開始せず**停止する (`parallel=1` ではそのまま即停止)
  - ユーザーに「EPIC #$ARGUMENTS を Sub-issue #<N> で停止: <検証結果 + 失敗理由>」+ PR URL (あれば) + 試行回数 + 想定外メモ + バッチ内他子の結果 を報告
  - スキルを終了

#### 1c. 進捗の記録

- 該当 Sub-issue にコメントを投稿して PR を紐づける (推奨):
  ```bash
  gh issue comment <N> --body "PR #<M> 作成済み (ローカルゲート pass / merge 待ち)。"
  ```
- EPIC 本文にチェックボックス形式の子リストがあっても、この時点では **`- [x]` にしない**。PR は未 merge であり、チェックすると未完了の作業が完了扱いに見える (PR が reject / 放置された場合、EPIC が偽の完了状態のまま残る)。チェックが付くのは PR merge → 子 issue close の後で、本スキルの担当外。PR 作成済みであることは前項の issue コメントと Step 2 のサマリで表現する
- リポジトリルートに PROGRESS.md があれば「現在地」を上書きし「ログ」に子の結果 1 エントリを追記 (「PROGRESS.md との連携」参照)
- **Sub-issue を close しない** (PR が merge されていないため)。merge 時に PR 本文の `Closes #<N>` で自動 close され、EPIC 進捗バーが進む

#### 1d. 親の git 状態をリセット (バッチごと)

子の worktree は `spawn_subagent` 終了時に自動 cleanup されるが、バッチの検証完了ごとに親 cwd の `<base>` ブランチも最新化:

- `git fetch origin <base>`
- `git checkout <base>` (もし違うブランチにいたら)
- `git pull --ff-only origin <base>` (他の PR が merge されていた場合に追従。**`git pull` 単体は稀に「divergent」誤判定で fail することがある** — `git merge --ff-only origin/<base>` で迂回可)
- `git status` で clean を確認

**子の Edit が親 worktree に着地している場合の救済**:
- `git status` に untracked file が出ている → 子の spill-over
- `rm -f <path>` で削除 (`-f` 必須。interactive 確認モードがブロックする可能性あり)
- 親側に `modified:` で出ている tracked file は `git checkout -- <path>` で復旧

#### 1e. 次のバッチへ

Step 1 へ戻り、次のバッチを処理する (`parallel=1` なら次の 1 件)。

### Step 2: 全バッチ処理完了 → EPIC へサマリ + 最終報告

ready-set のバッチ列を処理し切ったら:

1. EPIC issue にサマリコメントを投稿:
   ```bash
   gh issue comment $ARGUMENTS --body "$(cat <<'EOF'
   ## run-epic 実行サマリ (YYYY-MM-DD)

   - 実装 Sub-issue: N 件 (#... 〜 #...)
   - 作成 PR (merge 待ち):
     - #<M1> <URL>  (Closes #<N1>)
     - #<M2> <URL>  (Closes #<N2>)
   - ローカルゲート: 全 PR で pass 済み
   - バッチ構成 (parallel ≥ 2 のとき): 並列化したペアと根拠 / 直列化した理由
   - 依存 merge 待ちで今回未処理の子: #<X> (depends on #<Y>)
   - 想定外メモ: <子から集めた想定外を集約>
   - 次のアクション: 各 PR をレビュー後に手動 merge → Sub-issue が自動 close → EPIC 進捗バーが進む (merge 待ちの子があれば merge 後に /run-epic を再実行)
   EOF
   )"
   ```

2. ユーザーへの最終報告:
   - EPIC #$ARGUMENTS の処理サマリ / 実装 Sub-issue 数 / 使用した parallel / model 値 (model 未指定なら「セッションモデル継承」)
   - バッチ構成と根拠 (parallel ≥ 2 のとき)・依存 merge 待ちで未処理の子
   - config_source (workflow-grok / workflow-cc / auto-derive) と旧 `.claude/workflow.json` 検出時のリネーム案内 (該当時)
   - 全 PR URL (merge 待ちリスト、対応する `Closes #<N>` 付き)
   - **merge についての案内**: 「各 PR をレビュー後に手動で merge してください。merge すると `Closes #<N>` で Sub-issue が close され、EPIC の進捗バーが自動で進みます」
   - trustCI の扱い (true なら各 PR の checks 状態、false なら「CI 不参照」)
   - 想定外があれば、ユーザーが次に判断すべき点が分かるように

## 厳守事項

- **ローカルゲート失敗時は必ず停止**: 子が `failure` を返したら新しいバッチを開始しない (同一バッチの in-flight の検証・記録は完了させる)。ユーザーが介入してから手動で再起動 (`/run-epic $ARGUMENTS` を再実行すれば、未処理 (OPEN かつ verified-ready な PR を持たない) の Sub-issue から再開する)
- **自動 merge / 自動 close は行わない**: merge は人間が判断する。本スキルは PR 作成までを担当
- **子は原則 `isolation: "worktree"`**: 親の cwd を汚さない、作業空間を分離。ただし「実行方式の決定」の判定で worktree が成立しない環境では main checkout 直列に切り替え、最終報告に明記
- **既定は直列**: `parallel` 未指定 (= 1) では並列 spawn しない。`parallel ≥ 2` でも並列にできるのは**同一バッチ内の「並列可」判定済みの子だけ**。バッチ上限 `parallel` を超えない・main checkout モードでは並列しない・親の 1b 検証は常に直列
- **worktree 子は PROGRESS.md に触れない** (D11)。進捗集約は親のみが行う (main checkout 子はフック要求への追従のみ可)
- **EPIC / Sub-issue の close は親が手動でやらない**: PR merge 時の `Closes #<N>` に任せる
- **保護ブランチ直 push 禁止**: 各子は feature ブランチで PR 経由
- **再起動可能性**: スキル途中で停止しても、再実行すれば未処理の Sub-issue から再開する設計 (idempotent)。作業リストは「OPEN な Sub-issue のうち、**verified-ready** な OPEN PR をまだ持たないもの」(Step 0 の再分類参照)。トリアージ・バッチ分割は**毎回ゼロから再計算**し、wave 状態の永続ファイルは作らない (issue と PR が正)
- **子は slash command を呼ばない**: implement-issue のアルゴリズムを子自身のコンテキストで実行 (二重 spawn 回避)

## 既知の Gotcha

- `gh api /repos/<owner>/<repo>/issues/<EPIC>/sub_issues` が 404/空配列を返す場合は、EPIC に子が紐づいていない (または GHES 等で Sub-issues が無効) 可能性がある → ユーザーに確認
- リポジトリ固有の Gotcha は本スキルには書かない。**各リポジトリの AGENTS.md / CLAUDE.md の管轄** (子が読む)

## 参照ドキュメント (実装中に必要に応じて読む)

- EPIC issue 本文 + 各 Sub-issue 本文 (`gh issue view <N>`)
- 対象リポジトリの AGENTS.md / CLAUDE.md / `.grok/rules/` / `.claude/rules/` (規約・Gotcha)
- implement-issue SKILL.md (実装アルゴリズム本体 — 子が必ず最初に Read。パスは親が解決して子 prompt に埋め込む)

## 起動例

```
/run-epic 252
/run-epic 252 parallel=2
/run-epic 252 parallel=2 model=grok-4
```

→ EPIC #252 の OPEN な Sub-issues を処理し、各 PR を作成して merge 待ちにする。既定は上から順の直列。`parallel=2` では独立性トリアージで並列可と判定された子だけを最大 2 体ずつ同時実行する。`model=grok-4` を足すと子エージェントがそのモデルで動く (省略時はセッションモデル継承)。レビューは親が行う。途中で停止した場合は、原因を直してから同じコマンドを再実行すれば、未処理 (OPEN かつ verified-ready な PR を持たない) の Sub-issue から再開する。
