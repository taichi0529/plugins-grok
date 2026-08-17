---
description: Cancel an active background Codex job in this repository
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: run_terminal_command
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/codex-companion.mjs" cancel $ARGUMENTS
```
