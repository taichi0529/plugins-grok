# Claude plugin for Grok

[日本語版 README はこちら](README.ja.md)

Call the [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) from Grok. This is the inverse of [grok-cc](https://github.com/taichi0529/plugins-cc): the host is Grok and the backend is `claude -p --output-format stream-json`.

## Requirements

- Node.js
- Claude Code CLI:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

- Authentication: run `claude auth login` once (or set `ANTHROPIC_API_KEY`)

## Installation

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install claude-grok --trust
```

Then run `/claude-grok:setup`.

## Commands

All slash commands live under the `claude-grok` namespace. Most of them run `scripts/claude-companion.mjs` and return its stdout **verbatim**.

| Command | What it does |
|---|---|
| `/claude-grok:setup` | Check Node + Claude install/auth. Toggle the stop-time review gate |
| `/claude-grok:rescue` | Delegate investigation or a fix to `claude-grok:claude-rescue` |
| `/claude-grok:review` | Structured review of local git changes (no custom focus text) |
| `/claude-grok:adversarial-review` | Challenge-oriented review; optional focus text |
| `/claude-grok:status` | List or wait on companion jobs |
| `/claude-grok:result` | Show stored output of a finished job |
| `/claude-grok:cancel` | Cancel a queued/running background job |
| `/claude-grok:transfer` | Seed a Claude thread from the current Grok session |

Write-capable tasks use `--permission-mode bypassPermissions`. Reviews and read-only tasks use `plan`.

Do not install this next to `grok-cc` in a way that makes the two agents call each other in a loop.

## License

Apache License 2.0. See NOTICE.
