# Changelog

## 0.1.1

- Foreground jobs can be cancelled. `cancel` no longer treats "not a process-group leader" as "already gone", and a late progress write cannot overwrite a cancelled job.
- `codex-rescue` no longer adds `--background` itself. The caller already chose foreground or background. A failed launch returns `Codex unavailable: <reason>` instead of an empty reply.
- Review findings stay advisory. A workflow that already triages them (workflow-grok implement-issue) follows its own rules.

## 0.1.0

- Initial version: Grok-hosted companion for the Codex CLI, derived from
  grok-cc / the Codex plugin for Claude Code.
- Backend is one-shot `codex exec --json` (no app-server broker).
- Transfer seeds a new Codex thread from the current Grok session transcript.
