# Changelog

## 0.1.1

- Foreground jobs can be cancelled. `cancel` no longer treats "not a process-group leader" as "already gone", and a late progress write cannot overwrite a cancelled job.
- `claude-rescue` no longer adds `--background` itself. The caller already chose foreground or background. A failed launch returns `Claude unavailable: <reason>` instead of an empty reply.
- Review findings stay advisory. A workflow that already triages them (workflow-grok implement-issue) follows its own rules.

## 0.1.0

- Initial version: Grok-hosted companion for the Claude Code CLI, derived from
  grok-cc / the Codex plugin for Claude Code.
- Backend is one-shot `claude -p --output-format stream-json`.
- Transfer seeds a new Claude thread from the current Grok session transcript.
