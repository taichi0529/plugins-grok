---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the Claude rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model|haiku|sonnet|opus|fast>] [--effort <low|medium|high|xhigh|max>] [what Claude should investigate, solve, or continue]"
allowed-tools: run_terminal_command, ask_user_question, spawn_subagent
---

Invoke the `claude-grok:claude-rescue` subagent via `spawn_subagent` (`subagent_type: "claude-grok:claude-rescue"`), forwarding the raw user request as the prompt.
`claude-grok:claude-rescue` is a subagent, not a skill — do not call `Skill(claude-grok:claude-rescue)` or `Skill(claude-grok:rescue)` (that re-enters this command and hangs the session).
The final user-visible response must be Claude's output verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `claude-grok:claude-rescue` subagent in the background (`background: true`).
- If the request includes `--wait`, run the `claude-grok:claude-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Grok. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model` and `--effort` are runtime-selection flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- If the request includes `--resume`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Claude, check for a resumable rescue thread from this Grok session by running:

```bash
node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `ask_user_question` exactly once to ask whether to continue the current Claude thread or start a new one.
- The two choices must be:
  - `Continue current Claude thread`
  - `Start a new Claude thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Claude thread (Recommended)` first.
- Otherwise put `Start a new Claude thread (Recommended)` first.
- If the user chooses continue, add `--resume` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `run_terminal_command` call to invoke `node "${GROK_PLUGIN_ROOT}/scripts/claude-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Claude companion stdout verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Do not ask the subagent to inspect files, monitor progress, poll `/claude-grok:status`, fetch `/claude-grok:result`, call `/claude-grok:cancel`, summarize output, or do follow-up work of its own.
- Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort.
- Leave the model unset unless the user explicitly asks for one. If they ask for a shortcut, map it with `fast` / `haiku` → `haiku`.
- Leave `--resume` and `--fresh` in the forwarded request. The subagent handles that routing when it builds the `task` command.
- If the helper reports that Claude is missing or unauthenticated, stop and tell the user to run `/claude-grok:setup`.
- If the user did not supply a request, ask what Claude should investigate or fix.
