/**
 * Codex CLI runtime layer.
 *
 * One turn = one `codex exec --json` process. Threads resume via
 * `codex exec resume <session-id>`. Structured output uses `--output-schema`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readJsonFile } from "./fs.mjs";
import { extractGrokTranscriptExcerpt, buildTransferPrompt } from "./grok-session-transfer.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

const TASK_THREAD_PREFIX = "Codex Companion Task";
const DEFAULT_CONTINUE_PROMPT =
  "Continue from the current thread state. Pick the next highest-value step and follow through until the task is resolved.";
const PROGRESS_TEXT_INTERVAL_MS = 2000;
const AUTH_PROBE_TIMEOUT_MS = 30000;

const SANDBOX_PROFILES = new Map([
  ["read-only", "read-only"],
  ["workspace-write", "workspace-write"],
  ["workspace", "workspace-write"]
]);

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

function resolveSandboxProfile(sandbox) {
  return SANDBOX_PROFILES.get(sandbox ?? "read-only") ?? "read-only";
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

export function getCodexAvailability(cwd) {
  const versionStatus = binaryAvailable("codex", ["--version"], { cwd });
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
    detail: "Each review or task command runs a fresh `codex exec --json` process; sessions resume via `codex exec resume`.",
    endpoint: null
  };
}

export async function getCodexAuthStatus(cwd) {
  const availability = getCodexAvailability(cwd);
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

  const result = runCommand("codex", ["login", "status"], { cwd, timeout: AUTH_PROBE_TIMEOUT_MS });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const combined = `${stdout}\n${stderr}`.trim();
  const loggedIn = result.status === 0 && /logged in/i.test(combined) && !/not logged in|logged out/i.test(combined);

  return {
    available: true,
    loggedIn,
    detail: shorten(combined, 200) || (loggedIn ? "logged in" : "not authenticated"),
    source: "codex-login-status",
    authMethod: /api key|OPENAI_API_KEY/i.test(combined) ? "apiKey" : loggedIn ? "chatgpt" : null,
    verified: loggedIn ? true : null,
    provider: "openai"
  };
}

export function interruptCodexTurn() {
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: "Codex exec runs stop when their process tree is terminated."
  };
}

function writeTempSchema(schema) {
  const file = path.join(os.tmpdir(), `codex-grok-schema-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(schema)}\n`, "utf8");
  return file;
}

function buildCodexArgs(cwd, options) {
  const args = [];
  if (options.resumeThreadId) {
    args.push("exec", "resume", options.resumeThreadId);
  } else {
    args.push("exec");
  }

  args.push("--json", "--skip-git-repo-check", "-C", cwd, "-s", resolveSandboxProfile(options.sandbox));
  args.push("-c", "approval_policy=\"never\"");

  if (options.model) {
    args.push("-m", options.model);
  }
  if (options.effort) {
    args.push("-c", `model_reasoning_effort="${options.effort}"`);
  }
  if (options.schemaFile) {
    args.push("--output-schema", options.schemaFile);
  }
  args.push("-");
  return args;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractItemText(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        return part?.text ?? part?.output_text ?? "";
      })
      .join("");
  }
  return "";
}

function applyCodexEvent(capture, event) {
  const type = String(event.type ?? event.kind ?? "");
  const threadId = pickString(
    event.thread_id,
    event.threadId,
    event.session_id,
    event.sessionId,
    event.id && type.includes("thread") ? event.id : null
  );
  if (threadId) {
    capture.threadId = threadId;
  }

  if (/error|failed/i.test(type) && !/item\./.test(type)) {
    capture.errorEvent = { message: pickString(event.message, event.error, event.detail) || "Codex reported an error." };
    emitProgress(capture.onProgress, `Codex error: ${capture.errorEvent.message}`, "failed");
    return;
  }

  if (type === "item.completed" || type === "agent_message" || type === "message") {
    const item = event.item ?? event;
    const itemType = String(item.type ?? item.item_type ?? "");
    const text = extractItemText(item);
    if (/reason/i.test(itemType) && text) {
      const normalized = normalizeReasoningText(text);
      if (normalized && !capture.reasoningSections.includes(normalized)) {
        capture.reasoningSections.push(normalized);
        emitLogEvent(capture.onProgress, {
          message: `Reasoning: ${shorten(normalized, 96)}`,
          phase: "investigating",
          logTitle: "Reasoning summary",
          logBody: `- ${normalized}`
        });
      }
      return;
    }
    if (text && (/message|agent/i.test(itemType) || type === "message" || type === "agent_message")) {
      capture.textBuffer = text;
      if (!capture.sawText) {
        capture.sawText = true;
        emitProgress(capture.onProgress, "Codex is writing its answer.", "finalizing");
      }
    }
    return;
  }

  if (type === "turn.completed" || type === "task_complete" || type === "thread.completed") {
    capture.endEvent = event;
    if (event.last_agent_message) {
      capture.textBuffer = String(event.last_agent_message);
    }
  }
}

function spawnCodexTurn(cwd, args, prompt, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const capture = {
      textBuffer: "",
      reasoningSections: [],
      endEvent: null,
      errorEvent: null,
      threadId: null,
      sawText: false,
      lastTextProgressAt: 0,
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

    child.stdin.write(prompt);
    child.stdin.end();

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
          applyCodexEvent(capture, JSON.parse(line));
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
          applyCodexEvent(capture, JSON.parse(trailing));
        } catch {
          // ignore
        }
      }
      resolve({ capture, exitCode: code ?? 1, stderr });
    });
  });
}

export async function runCodexTurn(cwd, options = {}) {
  const availability = getCodexAvailability(cwd);
  if (!availability.available) {
    throw new Error(
      "Codex CLI is not installed. Install it with `npm i -g @openai/codex`, then rerun `/codex-grok:setup`."
    );
  }

  const prompt = options.prompt?.trim() || options.defaultPrompt || "";
  if (!prompt) {
    throw new Error("A prompt is required for this Codex run.");
  }

  const sandboxProfile = resolveSandboxProfile(options.sandbox);
  if (options.resumeThreadId) {
    emitProgress(options.onProgress, `Resuming Codex session ${options.resumeThreadId}.`, "starting");
  } else {
    emitProgress(options.onProgress, "Starting Codex session.", "starting");
  }

  let schemaFile = null;
  if (options.outputSchema) {
    schemaFile = writeTempSchema(options.outputSchema);
  }

  const filesBefore = sandboxProfile === "workspace-write" ? gitChangedFiles(cwd) : null;
  const startedAtMs = Date.now() - 1000;
  let capture;
  let exitCode;
  let stderr;
  try {
    const spawned = await spawnCodexTurn(
      cwd,
      buildCodexArgs(cwd, { ...options, schemaFile }),
      prompt,
      options.onProgress
    );
    capture = spawned.capture;
    exitCode = spawned.exitCode;
    stderr = spawned.stderr;
  } finally {
    if (schemaFile) {
      try {
        fs.unlinkSync(schemaFile);
      } catch {
        // ignore
      }
    }
  }

  const threadId = capture.threadId ?? options.resumeThreadId ?? null;
  if (threadId) {
    emitProgress(options.onProgress, `Session ready (${threadId}).`, "finalizing", { threadId });
  }

  let finalMessage = capture.textBuffer.trim();
  const structuredOutput = tryParseJson(finalMessage);
  if (structuredOutput) {
    finalMessage = JSON.stringify(structuredOutput);
  }

  const failed = exitCode !== 0 || Boolean(capture.errorEvent) || !finalMessage;
  const error = capture.errorEvent
    ? { message: capture.errorEvent.message }
    : failed && !finalMessage
      ? { message: stderr.trim() || `codex exited with code ${exitCode} before finishing the turn.` }
      : null;

  const touchedFiles = filesBefore ? diffTouchedFiles(cwd, filesBefore, gitChangedFiles(cwd), startedAtMs) : [];

  return {
    status: failed ? 1 : 0,
    threadId,
    turnId: null,
    finalMessage,
    structuredOutput,
    reasoningSummary: capture.reasoningSections,
    turn: { id: "codex-turn", status: failed ? "failed" : "completed" },
    error,
    stderr: stderr.trim(),
    fileChanges: [],
    touchedFiles,
    commandExecutions: []
  };
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function importGrokSession(cwd, options = {}) {
  if (!options.sourcePath) {
    throw new Error("A Grok session source path is required.");
  }
  const { excerpt, sessionId } = extractGrokTranscriptExcerpt(options.sourcePath);
  emitProgress(options.onProgress, "Seeding a Codex thread from the Grok session.", "transferring");
  const result = await runCodexTurn(cwd, {
    prompt: buildTransferPrompt(excerpt, "Codex"),
    sandbox: "read-only",
    onProgress: options.onProgress
  });
  if (result.status !== 0 || !result.threadId) {
    throw new Error(result.error?.message || result.stderr || "Codex transfer failed.");
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
      parseError: fallback.failureMessage ?? "Codex did not return a final structured message.",
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
