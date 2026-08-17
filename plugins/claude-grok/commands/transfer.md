---
description: Transfer the current Grok session into a resumable Claude thread
argument-hint: "[--source <chat_history.jsonl>]"
disable-model-invocation: true
allowed-tools: run_terminal_command
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" transfer $ARGUMENTS
```

Present the command output to the user exactly as returned. Preserve the Claude session ID and the `claude --resume <session-id>` command.
