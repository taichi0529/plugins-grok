# Codex plugin for Grok

[日本語版 README はこちら](README.ja.md)

Call the [Codex CLI](https://github.com/openai/codex) from Grok. This is a derivative of OpenAI's Codex plugin for Claude Code and of [grok-cc](https://github.com/taichi0529/plugins-cc), with the host swapped to Grok and the backend using `codex exec --json`.

## Requirements

- Node.js
- Codex CLI (`npm i -g @openai/codex`)
- Authentication: run `codex login` once (or set `OPENAI_API_KEY`)

## Installation

```bash
grok plugin marketplace add taichi0529/plugins-grok
grok plugin install codex-grok --trust
```

Then run `/codex-grok:setup`.

## Commands

All slash commands live under the `codex-grok` namespace. Most of them run `scripts/codex-companion.mjs` and return its stdout **verbatim**.

| Command | What it does |
|---|---|
| `/codex-grok:setup` | Check Node + Codex install/auth. Toggle the stop-time review gate |
| `/codex-grok:rescue` | Delegate investigation or a fix to `codex-grok:codex-rescue` |
| `/codex-grok:review` | Structured review of local git changes (no custom focus text) |
| `/codex-grok:adversarial-review` | Challenge-oriented review; optional focus text |
| `/codex-grok:status` | List or wait on companion jobs |
| `/codex-grok:result` | Show stored output of a finished job |
| `/codex-grok:cancel` | Cancel a queued/running background job |
| `/codex-grok:transfer` | Seed a Codex thread from the current Grok session |

Write-capable tasks use Codex sandbox `workspace-write`. Reviews and read-only tasks use `read-only`.

## License

Apache License 2.0. See NOTICE.
