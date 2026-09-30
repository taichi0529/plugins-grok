# plugins-grok

[日本語版 README はこちら](README.ja.md)

A [Grok Build](https://x.ai) plugin marketplace. Each plugin lives under `plugins/<name>/` and documents its own usage in its README.

Port of the Claude Code marketplace [plugins-cc](https://github.com/taichi0529/plugins-cc). The Grok-calling plugin (`grok-cc`) is not included — that would be circular on Grok. The inverses are here instead: `codex-grok` and `claude-grok`.

## Plugins

| Plugin | What it does | Docs |
|---|---|---|
| `workflow-grok` | PROGRESS.md persistence hooks (opt-in per repository) plus `implement-issue` / `run-epic` / `create-issue` skills for issue-driven development. | [README](plugins/workflow-grok/README.md) |
| `obsidian-grok` | Records what you did in a session into an Obsidian daily note, then commits and pushes it (`daily-report` skill). Vault paths are configured once via `/setup`. | [README](plugins/obsidian-grok/README.md) |
| `codex-grok` | Call Codex from Grok for reviews and rescue-style task delegation. | [README](plugins/codex-grok/README.md) |
| `claude-grok` | Call Claude Code from Grok for reviews and rescue-style task delegation. | [README](plugins/claude-grok/README.md) |

## Installation

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install workflow-grok --trust
grok plugin install obsidian-grok --trust
grok plugin install codex-grok --trust
grok plugin install claude-grok --trust
```

See each plugin's README for requirements and post-install setup.

### Local development

```bash
git clone https://github.com/taichi0529/plugins-grok.git
grok plugin install ./plugins-grok/plugins/<name> --trust
```

### Secret scanning

Commits are scanned by [gitleaks](https://github.com/gitleaks/gitleaks) through a pre-commit hook. Git hooks are not part of a clone, so enable it once after cloning:

```bash
brew install pre-commit gitleaks jq
pre-commit install
```

`bash scripts/check-versions.sh` checks that each plugin's `plugin.json` version matches `.grok-plugin/marketplace.json`. The same check runs in the pre-commit hook when either file is staged (`--quiet` drops the OK lines; failures stay on stderr).

On top of the default rules (API keys, tokens, private keys), `.gitleaks.toml` flags **local absolute paths** (`/Users/<name>/`, `/home/<name>/`) and **email addresses**. Use `/Users/you/`, `<name>`, and `example.com` in documentation; those are allowlisted. If the hook fires, fix the content rather than passing `--no-verify`.

## Repository layout

- `.grok-plugin/marketplace.json` — the marketplace definition
- `plugins/<name>/` — one directory per plugin, each with `plugin.json` and a README

## License

Apache License 2.0 (see [LICENSE](LICENSE)).
