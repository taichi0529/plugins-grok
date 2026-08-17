---
description: Show the stored final output for a finished Claude job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: run_terminal_command
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" result $ARGUMENTS
```

Present the full command output to the user. Do not summarize or condense it.
