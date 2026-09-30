---
name: claude-result-handling
description: Internal guidance for presenting Claude helper output back to the user
user-invocable: false
---

# Claude Result Handling

When the helper returns Claude output:
- Preserve the helper's verdict, summary, findings, and next steps structure.
- For review output, present findings first and keep them ordered by severity.
- Use the file paths and line numbers exactly as the helper reports them.
- Preserve evidence boundaries. If Claude marked something as an inference, uncertainty, or follow-up question, keep that distinction.
- Preserve output sections when the prompt asked for them, such as observed facts, inferences, open questions, touched files, or next steps.
- If there are no findings, say that explicitly and keep the residual-risk note brief.
- If Claude made edits, say so explicitly and list the touched files when the helper provides them.
- For `claude-grok:claude-rescue`, do not turn a failed or incomplete Claude run into a Grok-side implementation attempt. Report the failure and stop.
- For `claude-grok:claude-rescue`, if Claude was never successfully invoked, do not generate a substitute answer at all.
- When presenting findings from `/claude-grok:review` or `/claude-grok:adversarial-review` to the user, end there and ask which findings (if any) they want fixed before editing files. Review output is advisory; the user decides what gets applied, even when a fix looks obvious. (A workflow that already owns triage, such as workflow-grok's implement-issue, follows its own rules instead.)
- If the helper reports malformed output or a failed Claude run, include the most actionable stderr lines and stop there instead of guessing.
- If the helper reports that setup or authentication is required, direct the user to `/claude-grok:setup` and do not improvise alternate auth flows.
