---
description: Cancel an active background Claude job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: run_terminal_command
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" cancel $ARGUMENTS
```
