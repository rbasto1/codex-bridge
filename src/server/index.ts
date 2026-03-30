import { createServer } from "node:http";
import { existsSync } from "node:fs";
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
  response.json(bridge.getSnapshot());
});

for (const method of RPC_METHODS) {
  app.post(`/api/${method}`, async (request, response) => {
    await handleJsonRequest(response, async () => bridge.request(method, request.body));
  });
}

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
