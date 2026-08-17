---
description: Check whether the local Claude CLI is ready and optionally toggle the stop-time review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
allowed-tools: run_terminal_command, ask_user_question
---

Run:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" setup --json $ARGUMENTS
```

If the result says Claude is unavailable:
- Use `ask_user_question` exactly once to ask whether Grok should install Claude now.
- Put the install option first and suffix it with `(Recommended)`.
- Use these two options:
  - `Install Claude (Recommended)`
  - `Skip for now`
- If the user chooses install, run:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

- Then rerun:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" setup --json $ARGUMENTS
```

If Claude is already installed:
- Do not ask about installation.

Output rules:
- Present the final setup output to the user.
- If installation was skipped, present the original setup output.
- If Claude is installed but not authenticated, preserve the guidance to run `claude auth login`.
