/**
 * Claude Code CLI runtime layer.
 *
 * One turn = one `claude -p --output-format stream-json` process.
 * Threads resume via `claude --resume <session-id>`. Structured output uses `--json-schema`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { readJsonFile } from "./fs.mjs";
import { extractGrokTranscriptExcerpt, buildTransferPrompt } from "./grok-session-transfer.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const TASK_THREAD_PREFIX = "Claude Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";
const PROGRESS_TEXT_INTERVAL_MS = 2000;
const AUTH_PROBE_TIMEOUT_MS = 30000;

function shorten(text, limit = 96) {
  const normalized = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 3)}...`;
}

function emitProgress(onProgress, message, phase = null, extra = {}) {
  if (!onProgress || !message) {
    return;
  }
  if (!phase && Object.keys(extra).length === 0) {
    onProgress(message);
    return;
  }
  onProgress({ message, phase, ...extra });
}

function emitLogEvent(onProgress, options = {}) {
  if (!onProgress) {
    return;
  }
  onProgress({
    message: options.message ?? "",
    phase: options.phase ?? null,
    stderrMessage: options.stderrMessage ?? null,
    logTitle: options.logTitle ?? null,
    logBody: options.logBody ?? null
  });
}

function resolvePermissionMode(sandbox) {
  if (sandbox === "workspace-write" || sandbox === "workspace") {
    return "bypassPermissions";
  }
  return "plan";
}

function normalizeReasoningText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function gitChangedFiles(cwd) {
  const result = runCommand("git", ["status", "--porcelain", "--untracked-files=all"], { cwd });
  if (result.error || result.status !== 0) {
    return null;
  }
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => {
        const entry = line.slice(3).trim();
        const renameIndex = entry.indexOf(" -> ");
        return renameIndex === -1 ? entry : entry.slice(renameIndex + 4);
      })
      .filter(Boolean)
  );
}

function diffTouchedFiles(cwd, before, after, startedAtMs) {
  if (!before || !after) {
    return [];
  }
  const touched = [...after].filter((file) => {
    if (!before.has(file)) {
      return true;
    }
    try {
      return fs.lstatSync(path.join(cwd, file)).mtimeMs >= startedAtMs;
    } catch {
      return true;
    }
  });
  for (const file of before) {
    if (!after.has(file)) {
      touched.push(file);
    }
  }
  return touched;
}

export function getClaudeAvailability(cwd) {
  const versionStatus = binaryAvailable("claude", ["--version"], { cwd });
  if (!versionStatus.available) {
    return versionStatus;
  }
  return {
    available: true,
    detail: versionStatus.detail
  };
}

export function getSessionRuntimeStatus() {
  return {
    mode: "direct",
    label: "one-shot CLI",
    detail: "Each review or task command runs a fresh `claude -p --output-format stream-json` process; sessions resume via `claude --resume`.",
    endpoint: null
  };
}

export async function getClaudeAuthStatus(cwd) {
  const availability = getClaudeAvailability(cwd);
  if (!availability.available) {
    return {
      available: false,
      loggedIn: false,
      detail: availability.detail,
      source: "availability",
      authMethod: null,
      verified: null,
      provider: null
    };
  }

  const result = runCommand("claude", ["auth", "status", "--json"], { cwd, timeout: AUTH_PROBE_TIMEOUT_MS });
  try {
    const parsed = JSON.parse(String(result.stdout ?? "").trim() || "{}");
    const loggedIn = Boolean(parsed.loggedIn ?? parsed.logged_in);
    const method = parsed.authMethod ?? parsed.auth_method ?? null;
    const detail = loggedIn
      ? `logged in (${method || parsed.apiProvider || "claude"})`
      : "not authenticated";
    return {
      available: true,
      loggedIn,
      detail,
      source: "claude-auth-status",
      authMethod: method,
      verified: loggedIn ? true : null,
      provider: "anthropic"
    };
  } catch {
    const combined = `${result.stdout}\n${result.stderr}`.trim();
    const loggedIn = result.status === 0 && /logged in|authenticated/i.test(combined);
    return {
      available: true,
      loggedIn,
      detail: shorten(combined, 200) || (loggedIn ? "logged in" : "not authenticated"),
      source: "claude-auth-status",
      authMethod: null,
      verified: loggedIn ? true : null,
      provider: "anthropic"
    };
  }
}

export function interruptClaudeTurn() {
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: "Claude print-mode runs stop when their process tree is terminated."
  };
}

function buildClaudeArgs(options) {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", resolvePermissionMode(options.sandbox)];

  if (options.resumeThreadId) {
    args.push("--resume", options.resumeThreadId);
  }
  if (options.model) {
    args.push("--model", options.model);
  }
  if (options.effort) {
    args.push("--effort", options.effort);
  }
  if (options.outputSchema) {
    args.push("--json-schema", JSON.stringify(options.outputSchema));
  }
  args.push(options.prompt);
  return args;
}

function extractAssistantText(event) {
  const message = event.message ?? event;
  const content = message.content ?? event.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part?.type === "text") {
        return part.text ?? "";
      }
      return "";
    })
    .join("");
}

function applyClaudeEvent(capture, event) {
  const type = String(event.type ?? "");
  const sessionId = event.session_id ?? event.sessionId ?? null;
  if (sessionId) {
    capture.threadId = sessionId;
  }

  if (type === "assistant") {
    const text = extractAssistantText(event);
    if (text) {
      capture.textBuffer += text;
      if (!capture.sawText) {
        capture.sawText = true;
        emitProgress(capture.onProgress, "Claude is writing its answer.", "finalizing");
      }
    }
    return;
  }

  if (type === "result") {
    capture.endEvent = event;
    if (event.structured_output != null) {
      capture.structuredOutput = event.structured_output;
    } else if (event.structuredOutput != null) {
      capture.structuredOutput = event.structuredOutput;
    }
    if (!capture.textBuffer && typeof event.result === "string") {
      capture.textBuffer = event.result;
    }
    if (event.is_error || event.subtype === "error") {
      capture.errorEvent = { message: String(event.result ?? event.error ?? "Claude reported an error.") };
    }
    return;
  }

  if (type === "error") {
    capture.errorEvent = { message: String(event.message ?? event.error ?? "Claude reported an error.") };
    emitProgress(capture.onProgress, `Claude error: ${capture.errorEvent.message}`, "failed");
  }
}

function spawnClaudeTurn(cwd, args, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const capture = {
      textBuffer: "",
      reasoningSections: [],
      endEvent: null,
      errorEvent: null,
      structuredOutput: null,
      threadId: null,
      sawText: false,
      onProgress
    };
    let stdoutRemainder = "";
    let stderr = "";

    const forwardTermination = () => {
      try {
        child.kill("SIGTERM");
      } catch {
        // already gone
      }
    };
    process.once("SIGTERM", forwardTermination);
    process.once("SIGINT", forwardTermination);

    child.stdout.on("data", (chunk) => {
      stdoutRemainder += chunk.toString();
      let newlineIndex = stdoutRemainder.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutRemainder.slice(0, newlineIndex).trim();
        stdoutRemainder = stdoutRemainder.slice(newlineIndex + 1);
        newlineIndex = stdoutRemainder.indexOf("\n");
        if (!line) {
          continue;
        }
        try {
          applyClaudeEvent(capture, JSON.parse(line));
        } catch {
          // keep non-JSON out of the transcript
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      process.removeListener("SIGTERM", forwardTermination);
      process.removeListener("SIGINT", forwardTermination);
      const trailing = stdoutRemainder.trim();
      if (trailing) {
        try {
          applyClaudeEvent(capture, JSON.parse(trailing));
        } catch {
          // ignore
        }
      }
      resolve({ capture, exitCode: code ?? 1, stderr });
    });
  });
}

export async function runClaudeTurn(cwd, options = {}) {
  const availability = getClaudeAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Claude CLI is not installed. Install it with `curl -fsSL https://claude.ai/install.sh | bash`, then rerun `/claude-grok:setup`."
    );
  }

  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this Claude run.");
  }

  const writeCapable = options.sandbox === "workspace-write" || options.sandbox === "workspace";
  if (options.resumeThreadId) {
    emitProgress(options.onProgress, `Resuming Claude session ${options.resumeThreadId}.`, "starting");
  } else {
    emitProgress(options.onProgress, "Starting Claude session.", "starting");
  }

  const filesBefore = writeCapable ? gitChangedFiles(cwd) : null;
  const startedAtMs = Date.now() - 1000;
  const { capture, exitCode, stderr } = await spawnClaudeTurn(
    cwd,
    buildClaudeArgs({ ...options, prompt }),
    options.onProgress
  );

  const threadId = capture.threadId ?? options.resumeThreadId ?? null;
  if (threadId) {
    emitProgress(options.onProgress, `Session ready (${threadId}).`, "finalizing", { threadId });
  }

  let finalMessage = capture.textBuffer.trim();
  if (capture.structuredOutput != null) {
    finalMessage = JSON.stringify(capture.structuredOutput);
  }

  const failed = exitCode !== 0 || Boolean(capture.errorEvent) || !capture.endEvent;
  const error = capture.errorEvent
    ? { message: capture.errorEvent.message }
    : failed && !capture.endEvent
      ? { message: stderr.trim() || `claude exited with code ${exitCode} before finishing the turn.` }
      : null;

  const touchedFiles = filesBefore ? diffTouchedFiles(cwd, filesBefore, gitChangedFiles(cwd), startedAtMs) : [];

  return {
    status: failed ? 1 : 0,
    threadId,
    turnId: capture.endEvent?.uuid ?? null,
    finalMessage,
    structuredOutput: capture.structuredOutput,
    reasoningSummary: capture.reasoningSections,
    turn: capture.endEvent ? { id: capture.endEvent.uuid ?? "claude-turn", status: failed ? "failed" : "completed" } : null,
    error,
    stderr: stderr.trim(),
    fileChanges: [],
    touchedFiles,
    commandExecutions: []
  };
}

export async function importGrokSession(cwd, options = {}) {
  if (!options.sourcePath) {
    throw new Error("A Grok session source path is required.");
  }
  const { excerpt, sessionId } = extractGrokTranscriptExcerpt(options.sourcePath);
  emitProgress(options.onProgress, "Seeding a Claude thread from the Grok session.", "transferring");
  const result = await runClaudeTurn(cwd, {
    prompt: buildTransferPrompt(excerpt, "Claude"),
    sandbox: "read-only",
    onProgress: options.onProgress
  });
  if (result.status !== 0 || !result.threadId) {
    throw new Error(result.error?.message || result.stderr || "Claude transfer failed.");
  }
  emitProgress(options.onProgress, `Grok session ${sessionId} transferred (${result.threadId}).`, "completed", {
    threadId: result.threadId
  });
  return {
    threadId: result.threadId,
    stderr: result.stderr
  };
}

export async function findLatestTaskThread() {
  return null;
}

export function buildPersistentTaskThreadName(prompt) {
  const excerpt = shorten(prompt, 56);
  return excerpt ? `${TASK_THREAD_PREFIX}: ${excerpt}` : TASK_THREAD_PREFIX;
}

export function parseStructuredOutput(rawOutput, fallback = {}) {
  if (!rawOutput) {
    return {
      parsed: null,
      parseError: fallback.failureMessage ?? "Claude did not return a final structured message.",
      rawOutput: rawOutput ?? "",
      ...fallback
    };
  }

  try {
    return {
      parsed: JSON.parse(rawOutput),
      parseError: null,
      rawOutput,
      ...fallback
    };
  } catch (error) {
    return {
      parsed: null,
      parseError: error.message,
      rawOutput,
      ...fallback
    };
  }
}

export function readOutputSchema(schemaPath) {
  return readJsonFile(schemaPath);
}

export { DEFAULT_CONTINUE_PROMPT, TASK_THREAD_PREFIX };
