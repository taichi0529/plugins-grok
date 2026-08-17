#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { terminateProcessTree } from "./lib/process.mjs";
import { resolveStateFile, updateState, writeHostSession } from "./lib/state.mjs";
import { TRANSCRIPT_PATH_ENV } from "./lib/grok-session-transfer.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CODEX_COMPANION_DATA";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function hookField(input, camel, snake) {
  return input[camel] ?? input[snake] ?? null;
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  const envFile = process.env.GROK_ENV_FILE || process.env.CLAUDE_ENV_FILE;
  if (!envFile || value == null || value === "") {
    return;
  }
  fs.appendFileSync(envFile, `export ${name}=${shellEscape(value)}\n`, "utf8");
}

function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return;
  }

  let removedJobs = [];
  updateState(workspaceRoot, (state) => {
    removedJobs = state.jobs.filter((job) => job.sessionId === sessionId);
    state.jobs = state.jobs.filter((job) => job.sessionId !== sessionId);
  });

  for (const job of removedJobs) {
    const stillRunning = job.status === "queued" || job.status === "running";
    if (!stillRunning) {
      continue;
    }
    try {
      terminateProcessTree(job.pid ?? Number.NaN);
    } catch {
      // Ignore teardown failures during session shutdown.
    }
  }
}

function handleSessionStart(input) {
  const sessionId = hookField(input, "sessionId", "session_id") || process.env.GROK_SESSION_ID;
  const transcriptPath = hookField(input, "transcriptPath", "transcript_path");
  writeHostSession({
    sessionId,
    transcriptPath
  });
  appendEnvVar(SESSION_ID_ENV, sessionId);
  appendEnvVar(TRANSCRIPT_PATH_ENV, transcriptPath);
  appendEnvVar(PLUGIN_DATA_ENV, process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA);
}

function handleSessionEnd(input) {
  const cwd = input.cwd || process.env.GROK_WORKSPACE_ROOT || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  cleanupSessionJobs(cwd, hookField(input, "sessionId", "session_id") || process.env[SESSION_ID_ENV] || process.env.GROK_SESSION_ID);
}

function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? hookField(input, "hookEventName", "hook_event_name") ?? "";

  if (eventName === "SessionStart" || eventName === "session_start") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd" || eventName === "session_end") {
    handleSessionEnd(input);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
