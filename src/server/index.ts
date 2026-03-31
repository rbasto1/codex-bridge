import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";

import { CodexAppServerBridge, RpcResponseError } from "./codexAppServer.js";
import { isRecord, type RequestId, type RpcError } from "../shared/codex.js";

const PORT = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 4095);
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

app.use(express.json({ limit: "2mb" }));

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

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set.");
    }

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

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
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
      throw new Error(`OpenAI API error (${openaiResponse.status}): ${text}`);
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

app.get("/api/projects/state", (_request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "state.json");
  try {
    const raw = readFileSync(filePath, "utf-8");
    response.json(JSON.parse(raw));
  } catch {
    response.json({ projects: [], icons: {} });
  }
});

app.post("/api/projects/state", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "state.json");
  writeFileSync(filePath, JSON.stringify(request.body, null, 2));
  response.json({ ok: true });
});

app.get("/api/projects/icons/:projectId", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "icons", request.params.projectId);
  try {
    const icon = readFileSync(filePath, "utf-8").trim();
    response.json({ icon });
  } catch {
    response.json({ icon: null });
  }
});

app.post("/api/projects/icons/:projectId", (request, response) => {
  ensureCodexDir();
  const filePath = path.join(CODEX_DIR, "icons", request.params.projectId);
  const icon = isRecord(request.body) && typeof request.body.icon === "string" ? request.body.icon : "";
  writeFileSync(filePath, icon);
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
  console.log(`Codex Web Local listening on http://127.0.0.1:${PORT}`);
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

function isRpcError(value: unknown): value is RpcError {
  return isRecord(value) && typeof value.code === "number" && typeof value.message === "string";
}
