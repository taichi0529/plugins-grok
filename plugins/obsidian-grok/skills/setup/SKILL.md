---
name: setup
description: Obsidian vault の設定 (~/.grok/obsidian-grok.json) を作成・検証する。Use when the user runs /setup for Obsidian or /obsidian-grok:setup.
argument-hint: "[vault リポジトリの絶対パス]"
disable-model-invocation: true
allowed-tools:
  - read_file
  - ask_user_question
  - run_terminal_command
---

# obsidian-grok セットアップ

## 現在の設定

次を `run_terminal_command` で実行する。未設定時は exit 1 だが、出力の `STATUS:` で分岐するので続行してよい。

```bash
"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh check
```

- ユーザーが指定したパス: $ARGUMENTS

---

## 手順

ヘルパーは `"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh` の各サブコマンド (`check` / `write` / `allow-git`) を `run_terminal_command` で呼ぶ。**設定ファイルを自分で直接書かない** — 必ず `write` を通す。

### STATUS: ok の場合

設定内容を表で提示して終わる。ただし `$ARGUMENTS` にパスが渡されている場合は、まず下の「1. repoRoot を決める」と同じ方法で git ルートに解決してから、現在の `repoRoot` と比べる。**解決後の値が違う場合だけ** `ask_user_question` で「その値に作り直すか」を 1 回確認し、承認されたら「設定の作成」を `--force` 付きで実行する。渡されたパスが現在の `vaultDir` や `repoRoot` の配下を指しているだけなら、設定は既に正しいので作り直さない。

あわせて `gitAllowRule` が `~/.grok/config.toml` または `~/.claude/settings.json` に入っているかを確認する。無ければ「設定の作成」の手順 4 と同じ確認を取る。

### STATUS: unconfigured / invalid の場合

以下を順に進める。

#### 1. repoRoot を決める

`repoRoot` は **Obsidian vault を管理している git リポジトリのルート**。

- `$ARGUMENTS` にパスが渡されている場合、**それをそのまま `repoRoot` にしない**。必ずそこから git ルートを求める:

```bash
git -C <渡されたパス> rev-parse --show-toplevel
```

  この出力が `repoRoot`。渡されたパスがそれと異なる場合、渡されたパスは `vaultDir` の候補として使う。出力が空なら、その旨を伝えて下の探索に進む

- 渡されていなければ vault を探す:

```bash
find "$HOME" -maxdepth 4 -type d -name .obsidian -not -path "*/node_modules/*" 2>/dev/null
```

見つかった `.obsidian` の親ディレクトリが vault。そこから git リポジトリルートを求める。候補が複数あれば `ask_user_question` で 1 回だけ選ばせる。候補が 0 件なら、vault リポジトリの絶対パスを尋ねる。git 管理下にない vault はこのスキルでは扱えないので、「先に `git init` して remote を設定してほしい」と伝えて終了する。

#### 2. vaultDir / remote / branch を決める

- `vaultDir` = `.obsidian` があったディレクトリ。repoRoot と同じならそのまま repoRoot を使う。**repoRoot 配下である必要がある**
- `remote` = `git -C <repoRoot> remote` の 1 つ目（無ければ `origin`）
- `branch` = `git -C <repoRoot> symbolic-ref --short HEAD`（取れなければ `main`）
- `projectTag` = 既定の `project`

#### 3. 設定の作成

```bash
"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh write \
  --repo-root <repoRoot> \
  --vault-dir <vaultDir> \
  --remote <remote> \
  --branch <branch> \
  --project-tag <projectTag>
```

- `STATUS: written` なら成功
- `STATUS: exists` は既存ファイルがあるということ。上書きの可否を `ask_user_question` で確認してから `--force` を付けて再実行する
- `STATUS: invalid` なら問題点をそのままユーザーに見せて、直せるものは直して再実行する

#### 4. git 許可ルールの追加（任意・要確認）

`daily-report` skill は `git -C <repoRoot> ...` しか実行しないので、そのパスに限定した許可ルールを `~/.grok/config.toml` に入れておくと毎回の承認が不要になる。

`ask_user_question` で **1 回だけ** 確認する。

- 質問: 「`~/.grok/config.toml` に `Bash(git -C <repoRoot> *)` を追加する?」
- 選択肢 1（推奨）: `追加する (Recommended)` — 日報のたびに git の許可を求められなくなる。許可範囲はこの vault リポジトリのみ
- 選択肢 2: `追加しない` — 実行のたびに手動で承認する

承認されたときだけ実行する:

```bash
"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh allow-git
```

`STATUS: added` なら成功。`STATUS: already` なら既に入っていたということで、何もしなくてよい。

#### 5. 最終確認

```bash
"${GROK_PLUGIN_ROOT}"/scripts/obsidian-grok.sh check
```

`STATUS: ok` を確認して、次の内容を報告する。

- 書き込んだ設定（repoRoot / vaultDir / remote / branch / projectTag）
- git 許可ルールを追加したかどうか
- 使い方: `/obsidian-grok:daily-report [補足]` で今日の日報を記録できること

---

## 出力ルール

- 設定ファイルのパスと中身は必ずユーザーに見せる
- 失敗した項目は握り潰さず、ヘルパーの出力をそのまま伝える
- `~/.grok/config.toml` は手順 4 で承認されたときにしか触らない
