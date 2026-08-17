---
description: Run a Claude review that challenges the implementation approach and design choices
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
disable-model-invocation: true
allowed-tools: read_file, grep, list_dir, run_terminal_command, ask_user_question
---

Run an adversarial Claude review through the shared plugin runtime.
Position it as a challenge review that questions the chosen implementation, design choices, tradeoffs, and assumptions.
It is not just a stricter pass over implementation defects.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Claude's output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--wait`, do not ask. Run in the foreground.
- If the raw arguments include `--background`, do not ask. Run in the background.
- Otherwise, estimate the review size before asking using the same git checks as `/claude-grok:review`.
- Then use `ask_user_question` exactly once with two options, putting the recommended option first and suffixing its label with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Argument handling:
- Preserve the user's arguments exactly.
- Do not strip `--wait` or `--background` yourself.
- Unlike `/claude-grok:review`, extra focus text after the flags is allowed.

Foreground flow:
- Run:
```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" adversarial-review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not fix any issues mentioned in the review output.

Background flow:
- Launch with `run_terminal_command` and `background: true`.
- After launching, tell the user: "Claude adversarial review started in the background. Check `/claude-grok:status` for progress."
