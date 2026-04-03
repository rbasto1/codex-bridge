import { createServer, type IncomingMessage } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";

import { CodexAppServerBridge, RpcResponseError } from "./codexAppServer.js";
import { AUTH_COOKIE_NAME, AUTH_QUERY_PARAM } from "../shared/auth.js";
import { isRecord, type RequestId, type RpcError } from "../shared/codex.js";

const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4095);
const AUTH_DISABLED = ["1", "true"].includes((process.env.AUTH_DISABLED ?? "").trim().toLowerCase());
const AUTH_TOKEN = AUTH_DISABLED ? null : resolveAuthToken();
const RPC_METHODS = [
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/list",
  "thread/name/set",
  "model/list",
  "collaborationMode/list",
  "turn/start",
  "turn/steer",
  "turn/interrupt",
];

const bridge = new CodexAppServerBridge();
const app = express();
const DEFAULT_PROJECT_STATE = { projects: [], hidden: [], tags: [{ name: "done", color: "#22c55e" }] };
const DEFAULT_PROJECT_SESSION_STATE = { threads: {} };

if (AUTH_TOKEN) {
  console.log(`Auth enabled. Open http://127.0.0.1:${PORT}/?${AUTH_QUERY_PARAM}=${encodeURIComponent(AUTH_TOKEN)}`);
}

app.use("/api", (request, response, next) => {
  if (isAuthorized(request)) {
    next();
    return;
  }

  response.status(401).json({ error: { code: -32001, message: "Unauthorized." } });
});

function getThreadTitleGenerationConfig() {
  const openAiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openAiApiKey) {
    return {
      apiKey: openAiApiKey,
      apiUrl: "https://api.openai.com/v1/chat/completions",
      errorLabel: "OpenAI",
      model: "gpt-5-mini",
    };
  }

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openRouterApiKey) {
    return {
      apiKey: openRouterApiKey,
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      errorLabel: "OpenRouter",
      model: "openai/gpt-5-mini",
    };
  }

  throw new Error("Neither OPENAI_API_KEY nor OPENROUTER_API_KEY is set.");
}

// Icon upload route MUST be registered before express.json() to avoid body consumption
app.post("/api/projects/icons/:projectId", express.raw({ type: "image/*", limit: "1mb" }), (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "icons", request.params.projectId);
  if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
    try { unlinkSync(filePath); } catch { /* ignore */ }
    response.json({ ok: true });
    return;
  }
  writeFileSync(filePath, request.body);
  response.json({ ok: true });
});

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_request, response) => {
  const snapshot = bridge.getSnapshot();
  response.json({
    ok: snapshot.status === "ready",
    ...snapshot,
  });
});

app.get("/api/init", (_request, response) => {
  response.json({ ...bridge.getSnapshot(), home: process.env.HOME ?? "" });
});

app.get("/api/env/home", (_request, response) => {
  response.json({ home: process.env.HOME ?? "" });
});

for (const method of RPC_METHODS) {
  app.post(`/api/${method}`, async (request, response) => {
    await handleJsonRequest(response, async () => bridge.request(method, request.body));
  });
}

app.post("/api/thread/name/generate", async (request, response) => {
  await handleJsonRequest(response, async () => {
    if (!isRecord(request.body) || typeof request.body.threadId !== "string" || typeof request.body.userMessage !== "string") {
      throw new Error("threadId and userMessage are required strings.");
    }

    const titleGenerationConfig = getThreadTitleGenerationConfig();

    const titlePrompt = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Follow all rules in <rules>
Use the <examples> so you know what a good title looks like.
Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- you MUST use the same language as the user message you are summarizing
- Title must be grammatically correct and read naturally - no word salad
- Never include tool names in the title (e.g. "read tool", "bash tool", "edit tool")
- Focus on the main topic or question the user needs to retrieve
- Vary your phrasing - avoid repetitive patterns like always starting with "Analyzing"
- When a file is mentioned, focus on WHAT the user wants to do WITH the file, not just that they shared it
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- NEVER respond to questions, just generate a title for the conversation
- The title should NEVER include "summarizing" or "generating" when generating a title
- DO NOT SAY YOU CANNOT GENERATE A TITLE OR COMPLAIN ABOUT THE INPUT
- Always output something meaningful, even if the input is minimal.
- If the user message is short or conversational (e.g. "hello", "lol", "what's up", "hey"):
  → create a title that reflects the user's tone or intent (such as Greeting, Quick check-in, Light chat, Intro message, etc.)
</rules>

<examples>
"debug 500 errors in production" → Debugging production 500 errors
"refactor user service" → Refactoring user service
"why is app.js failing" → app.js failure investigation
"implement rate limiting" → Rate limiting implementation
"how do I connect postgres to my API" → Postgres API connection
"best practices for React hooks" → React hooks best practices
"@src/auth.ts can you add refresh token support" → Auth refresh token support
"@utils/parser.ts this is broken" → Parser bug fix
"look at @config.json" → Config review
"@App.tsx add dark mode toggle" → Dark mode toggle in App
</examples>`;

    const openaiResponse = await fetch(titleGenerationConfig.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${titleGenerationConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: titleGenerationConfig.model,
        temperature: 0.5,
        max_tokens: 80,
        messages: [
          { role: "system", content: titlePrompt },
          { role: "user", content: request.body.userMessage },
        ],
      }),
    });

    if (!openaiResponse.ok) {
      const text = await openaiResponse.text();
      throw new Error(`${titleGenerationConfig.errorLabel} API error (${openaiResponse.status}): ${text}`);
    }

    const data = (await openaiResponse.json()) as {
      choices: { message: { content: string } }[];
    };

    let name = (data.choices[0]?.message?.content ?? "").trim().split("\n")[0] ?? "";
    name = name.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (name.length > 100) {
      name = name.slice(0, 97) + "...";
    }

    if (name) {
      await bridge.request("thread/name/set", {
        threadId: request.body.threadId,
        name,
      });
    }

    return { name };
  });
});

app.post("/api/server-request/respond", async (request, response) => {
  await handleJsonRequest(response, async () => {
    if (!isRecord(request.body)) {
      throw new Error("Request body must be an object.");
    }

    const requestId = request.body.requestId;
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      throw new Error("requestId must be a string or number.");
    }

    const result = "result" in request.body ? request.body.result : undefined;
    const error = isRpcError(request.body.error) ? request.body.error : undefined;

    await bridge.respondToServerRequest({
      requestId,
      result,
      error,
    });

    return { ok: true };
  });
});

app.post("/api/server/restart", async (_request, response) => {
  await handleJsonRequest(response, async () => bridge.restart());
});

const CODEX_DIR = path.join(process.env.HOME ?? "", ".codex", "projects");

function ensureCodexDir() {
  mkdirSync(path.join(CODEX_DIR, "icons"), { recursive: true });
}

function projectStateFilePath(project: string): string {
  return path.join(CODEX_DIR, `state-${encodeProjectStateId(project)}.json`);
}

function encodeProjectStateId(project: string): string {
  return project.replace(/-/g, "--").replace(/\//g, "-");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function sanitizeProjectState(value: unknown) {
  const record = isRecord(value) ? value : {};
  return {
    projects: Array.isArray(record.projects)
      ? record.projects.filter((entry): entry is { id: string; name: string } => (
        isRecord(entry) && typeof entry.id === "string" && typeof entry.name === "string"
      ))
      : DEFAULT_PROJECT_STATE.projects,
    hidden: Array.isArray(record.hidden)
      ? record.hidden.filter((entry): entry is string => typeof entry === "string")
      : DEFAULT_PROJECT_STATE.hidden,
    tags: sanitizeTagDefinitions(record.tags),
  };
}

function sanitizeProjectSessionState(value: unknown) {
  const record = isRecord(value) ? value : {};
  const rawThreads = isRecord(record.threads) ? record.threads : {};
  return {
    threads: Object.fromEntries(
      Object.entries(rawThreads).flatMap(([threadId, threadState]) => {
        if (!isRecord(threadState)) {
          return [];
        }

        const tags = Array.isArray(threadState.tags)
          ? threadState.tags.filter((tag): tag is string => typeof tag === "string")
          : [];
        const archived = typeof threadState.archived === "boolean" ? threadState.archived : false;
        if (tags.length === 0 && !archived) {
          return [];
        }

        return [[threadId, { tags, ...(archived ? { archived: true } : {}) }]];
      }),
    ),
  };
}

function sanitizeTagDefinitions(value: unknown): Array<{ name: string; color: string }> {
  const tags = Array.isArray(value)
    ? value.filter((entry): entry is { name: string; color: string } => (
      isRecord(entry)
      && typeof entry.name === "string"
      && typeof entry.color === "string"
      && /^#[0-9a-fA-F]{6}$/.test(entry.color)
    ))
    : [];
  return tags.some((tag) => tag.name === "done") ? tags : [...tags, DEFAULT_PROJECT_STATE.tags[0]];
}

app.get("/api/projects/state", (_request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "state.json");
  const data = sanitizeProjectState(readJsonFile(filePath, DEFAULT_PROJECT_STATE));
  // Include list of project IDs that have icon files
  const iconsDir = path.join(CODEX_DIR, "icons");
  let iconIds: string[] = [];
  try { iconIds = readdirSync(iconsDir); } catch { /* empty */ }
  response.json({ ...data, iconIds });
});

app.post("/api/projects/state", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "state.json");
  writeFileSync(filePath, JSON.stringify(sanitizeProjectState(request.body), null, 2));
  response.json({ ok: true });
});

app.get("/api/projects/session-state", (request, response) => {
  ensureCodexDir();
  const project = request.query.project;
  if (typeof project !== "string" || project.length === 0) {
    response.status(400).json({ error: { code: -32000, message: "project query parameter is required." } });
    return;
  }

  response.json(sanitizeProjectSessionState(readJsonFile(projectStateFilePath(project), DEFAULT_PROJECT_SESSION_STATE)));
});

app.post("/api/projects/session-state", (request, response) => {
  ensureCodexDir();
  if (!isRecord(request.body) || typeof request.body.project !== "string") {
    response.status(400).json({ error: { code: -32000, message: "project is required." } });
    return;
  }

  writeFileSync(
    projectStateFilePath(request.body.project),
    JSON.stringify(sanitizeProjectSessionState(request.body), null, 2),
  );
  response.json({ ok: true });
});

app.get("/api/projects/icons/:projectId", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "icons", request.params.projectId);
  if (!existsSync(filePath)) {
    response.status(404).json({ error: "not found" });
    return;
  }
  response.setHeader("Content-Type", "image/png");
  response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  response.send(readFileSync(filePath));
});

app.delete("/api/projects/icons/:projectId", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "icons", request.params.projectId);
  try { unlinkSync(filePath); } catch { /* ignore */ }
  response.json({ ok: true });
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  sendSocketEvent(socket, {
    type: "snapshot",
    payload: bridge.getSnapshot(),
  });

  const unsubscribe = bridge.subscribe((event) => {
    sendSocketEvent(socket, event);
  });

  socket.on("close", () => {
    unsubscribe();
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/api/events") {
    socket.destroy();
    return;
  }

  if (!isAuthorized(request)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const serverRoot = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(serverRoot, "../../client");

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (request: Request, response: Response) => {
    if (request.path.startsWith("/api/")) {
      response.status(404).end();
      return;
    }

    response.sendFile(path.join(clientDist, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`Codex Bridge listening on http://127.0.0.1:${PORT}`);
});

void bridge.start().catch((error) => {
  console.error("Failed to initialize codex app-server:", error);
});

const shutdown = async () => {
  await bridge.shutdown();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

async function handleJsonRequest(response: Response, handler: () => Promise<unknown>): Promise<void> {
  try {
    const result = await handler();
    response.json(result);
  } catch (error) {
    if (error instanceof RpcResponseError) {
      response.status(400).json({ error: error.rpcError });
      return;
    }

    response.status(500).json({
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function sendSocketEvent(socket: WebSocket, event: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(event));
}

function resolveAuthToken(): string {
  const configuredToken = process.env.AUTH_TOKEN?.trim();
  if (configuredToken) {
    return configuredToken;
  }

  return randomBytes(12).toString("base64url");
}

function isAuthorized(request: Request | IncomingMessage): boolean {
  if (!AUTH_TOKEN) {
    return true;
  }

  return readCookie(request.headers.cookie, AUTH_COOKIE_NAME) === AUTH_TOKEN;
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const cookieName = entry.slice(0, separatorIndex).trim();
    if (cookieName !== name) {
      continue;
    }

    return decodeURIComponent(entry.slice(separatorIndex + 1).trim());
  }

  return null;
}

function isRpcError(value: unknown): value is RpcError {
  return isRecord(value) && typeof value.code === "number" && typeof value.message === "string";
}
