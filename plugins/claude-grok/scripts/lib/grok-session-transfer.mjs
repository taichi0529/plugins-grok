import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureAbsolutePath } from "./fs.mjs";
import { getHostSessionId, readHostSession } from "./state.mjs";
import { resolveWorkspaceRoot } from "./workspace.mjs";

export const TRANSCRIPT_PATH_ENV = "CLAUDE_COMPANION_TRANSCRIPT_PATH";
const GROK_SESSIONS_DIR = path.join(os.homedir(), ".grok", "sessions");
const MAX_EXCERPT_CHARS = 24000;
const MAX_MESSAGES = 40;

function resolveUserPath(cwd, value) {
  if (value === "~") {
    return os.homedir();
  }
  if (String(value).startsWith("~/")) {
    return path.join(os.homedir(), String(value).slice(2));
  }
  return ensureAbsolutePath(cwd, value);
}

function encodeSessionDir(workspaceRoot) {
  return encodeURIComponent(workspaceRoot);
}

function extractText(content) {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object") {
        if (typeof part.text === "string") {
          return part.text;
        }
        if (part.type === "text" && typeof part.content === "string") {
          return part.content;
        }
      }
      return "";
    })
    .join("")
    .trim();
}

function extractUserQuery(text) {
  const match = String(text).match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  return match ? match[1].trim() : text.trim();
}

export function resolveGrokSessionDir(cwd, options = {}) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const encoded = encodeSessionDir(workspaceRoot);
  return path.join(GROK_SESSIONS_DIR, encoded, options.sessionId);
}

export function resolveGrokSessionPath(cwd, options = {}) {
  const requestedPath = options.source || process.env[TRANSCRIPT_PATH_ENV] || readHostSession()?.transcriptPath;
  if (requestedPath) {
    const sourcePath = resolveUserPath(cwd, requestedPath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Grok session source not found: ${sourcePath}`);
    }
    return sourcePath;
  }

  const sessionId = options.sessionId || getHostSessionId();
  if (!sessionId) {
    throw new Error(
      "Could not identify the current Grok session. Retry with --source <path-to-chat_history.jsonl>."
    );
  }

  const sessionDir = resolveGrokSessionDir(cwd, { sessionId });
  const transcript = path.join(sessionDir, "chat_history.jsonl");
  if (!fs.existsSync(transcript)) {
    throw new Error(`Grok session transcript not found: ${transcript}`);
  }
  return transcript;
}

export function extractGrokTranscriptExcerpt(sourcePath) {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const messages = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const type = parsed.type;
    if (type === "user") {
      const text = extractUserQuery(extractText(parsed.content));
      if (text && !text.startsWith("<system-reminder>") && !text.startsWith("<user_info>")) {
        messages.push({ role: "user", text });
      }
    } else if (type === "assistant") {
      const text = extractText(parsed.content);
      if (text) {
        messages.push({ role: "assistant", text });
      }
    }
  }

  const recent = messages.slice(-MAX_MESSAGES);
  const blocks = recent.map((message) => `${message.role}:\n${message.text}`);
  let excerpt = blocks.join("\n\n");
  if (excerpt.length > MAX_EXCERPT_CHARS) {
    excerpt = excerpt.slice(excerpt.length - MAX_EXCERPT_CHARS);
    const cut = excerpt.indexOf("\n");
    if (cut > 0) {
      excerpt = excerpt.slice(cut + 1);
    }
    excerpt = `[truncated]\n${excerpt}`;
  }

  const sessionId = path.basename(path.dirname(sourcePath));
  return {
    sourcePath,
    sessionId,
    excerpt,
    messageCount: recent.length
  };
}

export function buildTransferPrompt(excerpt, guestName) {
  return [
    `This is a handoff from a Grok Build session. Continue in ${guestName} using the prior context below.`,
    "Do not restart the investigation from scratch unless the context is insufficient.",
    "Acknowledge the transfer in one short paragraph, then wait for the next instruction unless the transcript already contains an unfinished explicit task.",
    "",
    "<grok_transcript>",
    excerpt,
    "</grok_transcript>"
  ].join("\n");
}
