// claude-nas bridge
// Exposes Claude Code (via the official Claude Agent SDK) behind an
// OpenAI-compatible HTTP API so Open WebUI (or any OpenAI client) can chat with it.
//
// Zero third-party HTTP deps on purpose (auditable): Node built-in `http` only.
// The single runtime dependency is @anthropic-ai/claude-agent-sdk.

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";

const PORT = parseInt(process.env.PORT || "8000", 10);
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || "";
const WORKSPACE = process.env.CLAUDE_WORKSPACE || "/workspace";
const DEFAULT_MODEL = process.env.CLAUDE_MODEL || "sonnet";
const PERMISSION_MODE = process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";
const MAX_TURNS = parseInt(process.env.MAX_TURNS || "40", 10);
const SHOW_TOOL_CALLS = (process.env.SHOW_TOOL_CALLS || "true") !== "false";
const ALLOWED_TOOLS = (process.env.ALLOWED_TOOLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Advertised model ids (shown in the Open WebUI model picker) -> SDK model alias.
const MODELS = {
  "claude-code": "sonnet",
  "claude-sonnet": "sonnet",
  "claude-opus": "opus",
  "claude-haiku": "haiku",
};

function mapModel(requested) {
  if (!requested) return DEFAULT_MODEL;
  if (MODELS[requested]) return MODELS[requested];
  return requested; // pass full ids (e.g. "claude-sonnet-4-6") straight through
}

function checkAuth(req) {
  if (!BRIDGE_API_KEY) return true; // open if no key set (internal network only)
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return token === BRIDGE_API_KEY;
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
  }
  return "";
}

// Flatten the OpenAI message list into a single prompt.
// Prior turns are passed as read-only context so the agent does not re-run past work.
function buildPrompt(messages) {
  const sys = messages
    .filter((m) => m.role === "system")
    .map((m) => textOf(m.content))
    .join("\n\n")
    .trim();

  const convo = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const last = convo[convo.length - 1];
  const lastText = last ? textOf(last.content) : "";
  const prior = convo.slice(0, -1);

  let prompt = lastText;
  if (prior.length) {
    const transcript = prior
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${textOf(m.content)}`)
      .join("\n\n");
    prompt =
      `Previous conversation (context only — do not redo past work):\n${transcript}\n\n` +
      `Current message:\n${lastText}`;
  }
  return { prompt, sys };
}

function buildOptions(model, sys) {
  const opts = {
    cwd: WORKSPACE,
    model,
    permissionMode: PERMISSION_MODE,
    maxTurns: MAX_TURNS,
    persistSession: false,
    env: process.env, // carries CLAUDE_CODE_OAUTH_TOKEN through to the subprocess
    tools: { type: "preset", preset: "claude_code" },
    systemPrompt: sys
      ? { type: "preset", preset: "claude_code", append: sys }
      : { type: "preset", preset: "claude_code" },
  };
  if (PERMISSION_MODE === "bypassPermissions") opts.allowDangerouslySkipPermissions = true;
  if (ALLOWED_TOOLS.length) opts.allowedTools = ALLOWED_TOOLS;
  return opts;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function summarizeToolInput(input) {
  if (!input || typeof input !== "object") return "";
  const k = input.command || input.file_path || input.path || input.pattern || input.url;
  return k ? truncate(String(k), 80) : "";
}

// Render one SDK assistant message to chat text (and optional tool-activity notes).
function renderAssistant(msg) {
  let out = "";
  const content = msg?.message?.content || [];
  for (const block of content) {
    if (block.type === "text") out += block.text;
    else if (block.type === "tool_use" && SHOW_TOOL_CALLS) {
      const summary = summarizeToolInput(block.input);
      out += `\n\n\`🔧 ${block.name}${summary ? " " + summary : ""}\`\n\n`;
    }
  }
  return out;
}

async function handleChat(req, res, body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const stream = !!body.stream;
  const model = mapModel(body.model);
  const { prompt, sys } = buildPrompt(messages);
  const options = buildOptions(model, sys);

  const id = "chatcmpl-" + randomUUID();
  const created = Math.floor(Date.now() / 1000);

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    const sendChunk = (delta, finish_reason = null) => {
      const payload = {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason }],
      };
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    sendChunk({ role: "assistant", content: "" });
    try {
      for await (const msg of query({ prompt, options })) {
        if (msg.type === "assistant") {
          const text = renderAssistant(msg);
          if (text) sendChunk({ content: text });
        } else if (msg.type === "result") {
          if (msg.subtype !== "success" && Array.isArray(msg.errors) && msg.errors.length) {
            sendChunk({ content: `\n\n⚠️ ${msg.errors.join("; ")}` });
          }
          break;
        }
      }
    } catch (err) {
      sendChunk({ content: `\n\n⚠️ Bridge error: ${err?.message || err}` });
    }
    sendChunk({}, "stop");
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // Non-streaming
  let content = "";
  let usage = null;
  try {
    for await (const msg of query({ prompt, options })) {
      if (msg.type === "assistant") content += renderAssistant(msg);
      else if (msg.type === "result") {
        if (msg.usage) usage = msg.usage;
        if (msg.subtype === "success" && !content) content = msg.result || "";
        break;
      }
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: String(err?.message || err), type: "bridge_error" } }));
    return;
  }

  const respUsage = usage
    ? {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      }
    : undefined;

  const payload = {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    ...(respUsage ? { usage: respUsage } : {}),
  };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function handleModels(res) {
  const created = Math.floor(Date.now() / 1000);
  const data = Object.keys(MODELS).map((id) => ({
    id,
    object: "model",
    created,
    owned_by: "anthropic-claude-code",
  }));
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ object: "list", data }));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10 * 1024 * 1024) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = (req.url || "").split("?")[0];

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (!checkAuth(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unauthorized", type: "auth_error" } }));
      return;
    }

    if (req.method === "GET" && url === "/v1/models") return handleModels(res);
    if (req.method === "POST" && url === "/v1/chat/completions") {
      const body = await readJson(req);
      return await handleChat(req, res, body);
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found", type: "not_found" } }));
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(err?.message || err), type: "bridge_error" } }));
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

server.listen(PORT, () => {
  console.log(
    `[claude-bridge] listening on :${PORT} (cwd=${WORKSPACE}, model=${DEFAULT_MODEL}, permission=${PERMISSION_MODE})`
  );
});
