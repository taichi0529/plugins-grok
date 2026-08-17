---
description: Transfer the current Grok session into a resumable Codex thread
argument-hint: "[--source <chat_history.jsonl>]"
disable-model-invocation: true
allowed-tools: run_terminal_command
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/codex-companion.mjs" transfer $ARGUMENTS
```

Present the command output to the user exactly as returned. Preserve the Codex session ID and the `codex exec resume <session-id>` command.
