import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import {
  isRecord,
  serializeRequestId,
  type AppServerExit,
  type AppServerStatus,
  type BackendSnapshot,
  type BrowserEvent,
  type BrowserServerRequest,
  type InitializeResponse,
  type RequestId,
  type RpcError,
} from "../shared/codex.js";

const REQUEST_TIMEOUT_MS = 120_000;
const STDERR_TAIL_LIMIT = 200;

type JsonRpcRequest = {
  id: RequestId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  id: RequestId;
  result?: unknown;
  error?: RpcError;
};

type PendingRequest = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: NodeJS.Timeout;
};

export class RpcResponseError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(rpcError.message);
  }
}

export class CodexAppServerBridge {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutReader: Interface | null = null;
  private stderrReader: Interface | null = null;
  private readonly listeners = new Set<(event: BrowserEvent) => void>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly pendingServerRequests = new Map<string, BrowserServerRequest>();
  private nextRequestId = 1;
  private startPromise: Promise<void> | null = null;
  private status: AppServerStatus = "starting";
  private initializeResponse: InitializeResponse | null = null;
  private stderrTail: string[] = [];
  private lastExit: AppServerExit = null;

  subscribe(listener: (event: BrowserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): BackendSnapshot {
    return {
      status: this.status,
      initializeResponse: this.initializeResponse,
      pendingServerRequests: [...this.pendingServerRequests.values()],
      stderrTail: [...this.stderrTail],
      lastExit: this.lastExit,
      pid: this.child?.pid ?? null,
    };
  }

  async start(): Promise<void> {
    if (this.status === "ready") {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async request(method: string, params: unknown): Promise<unknown> {
    await this.ensureReady();
    return this.sendRequestInternal(method, this.normalizeParams(method, params), REQUEST_TIMEOUT_MS);
  }

  async respondToServerRequest(body: {
    requestId: RequestId;
    result?: unknown;
    error?: RpcError;
  }): Promise<void> {
    if (this.status !== "ready") {
      throw new Error("Codex app-server is not ready.");
    }

    const key = serializeRequestId(body.requestId);
    if (!this.pendingServerRequests.has(key)) {
      throw new Error(`Unknown app-server request id: ${key}`);
    }

    this.pendingServerRequests.delete(key);
    this.sendMessage(
      body.error
        ? {
            id: body.requestId,
            error: body.error,
          }
        : {
            id: body.requestId,
            result: body.result ?? {},
          },
    );
  }

  async restart(): Promise<BackendSnapshot> {
    this.rejectAllPending(new Error("Codex app-server restarted."));
    this.pendingServerRequests.clear();
    this.destroyCurrentChild();
    this.initializeResponse = null;
    this.setStatus("starting");
    await this.start();
    return this.getSnapshot();
  }

  async shutdown(): Promise<void> {
    this.rejectAllPending(new Error("Codex web backend shutting down."));
    this.pendingServerRequests.clear();
    this.destroyCurrentChild();
  }

  private async startInternal(): Promise<void> {
    this.initializeResponse = null;
    this.setStatus("starting");

    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });

    this.child = child;
    child.stdin.setDefaultEncoding("utf8");

    this.stdoutReader = createInterface({ input: child.stdout });
    this.stderrReader = createInterface({ input: child.stderr });

    this.stdoutReader.on("line", (line) => {
      if (this.child !== child) {
        return;
      }

      void this.handleStdoutLine(line);
    });

    this.stderrReader.on("line", (line) => {
      if (this.child !== child) {
        return;
      }

      this.pushStderr(line);
    });

    child.on("error", (error) => {
      if (this.child !== child) {
        return;
      }

      this.pushStderr(error.message);
    });

    child.on("exit", (code, signal) => {
      if (this.child !== child) {
        return;
      }

      void this.handleChildExit(code, signal);
    });

    try {
      const result = await this.sendRequestInternal(
        "initialize",
        {
          clientInfo: {
            name: "codex_web_local",
            title: "Codex Web Local",
            version: "0.1.0",
          },
          capabilities: {
            experimentalApi: true,
          },
        },
        REQUEST_TIMEOUT_MS,
      );

      if (!isRecord(result)) {
        throw new Error("Invalid initialize response from codex app-server.");
      }

      this.initializeResponse = result as InitializeResponse;
      this.sendNotification("initialized");
      this.lastExit = null;
      this.setStatus("ready");
    } catch (error) {
      this.pushStderr(error instanceof Error ? error.message : String(error));
      this.rejectAllPending(error);
      this.destroyCurrentChild();
      this.setStatus("error");
      throw error;
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.isReady()) {
      return;
    }

    await this.start();

    if (!this.isReady()) {
      throw new Error("Codex app-server is not ready.");
    }
  }

  private normalizeParams(method: string, params: unknown): Record<string, unknown> {
    const next = isRecord(params) ? { ...params } : {};

    if (method === "thread/start") {
      return {
        serviceName: "codex_web_local",
        experimentalRawEvents: false,
        persistExtendedHistory: true,
        ...next,
      };
    }

    if (method === "thread/resume") {
      return {
        persistExtendedHistory: true,
        ...next,
      };
    }

    return next;
  }

  private sendNotification(method: string, params?: unknown): void {
    this.sendMessage(params === undefined ? { method } : { method, params });
  }

  private sendRequestInternal(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const key = serializeRequestId(requestId);
      const timer = setTimeout(() => {
        this.pendingRequests.delete(key);
        reject(new Error(`Timed out waiting for codex app-server response to ${method}.`));
      }, timeoutMs);

      this.pendingRequests.set(key, {
        method,
        resolve,
        reject,
        timer,
      });

      try {
        this.sendMessage({
          id: requestId,
          method,
          params,
        });
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(key);
        reject(error);
      }
    });
  }

  private sendMessage(message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse): void {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex app-server stdin is unavailable.");
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async handleStdoutLine(line: string): Promise<void> {
    if (!line.trim()) {
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.pushStderr(`Unexpected stdout payload: ${line}`);
      return;
    }

    if (isJsonRpcResponse(message)) {
      this.handleResponse(message);
      return;
    }

    if (isJsonRpcRequest(message)) {
      this.handleServerRequest(message);
      return;
    }

    if (isJsonRpcNotification(message)) {
      this.handleNotification(message);
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const key = serializeRequestId(response.id);
    const pending = this.pendingRequests.get(key);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingRequests.delete(key);

    if (response.error) {
      pending.reject(new RpcResponseError(response.error));
      return;
    }

    pending.resolve(response.result);
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    const params = isRecord(request.params) ? request.params : null;
    const serverRequest: BrowserServerRequest = {
      key: serializeRequestId(request.id),
      requestId: request.id,
      method: request.method,
      params,
      receivedAt: new Date().toISOString(),
      threadId: params && typeof params.threadId === "string" ? params.threadId : null,
      turnId: params && typeof params.turnId === "string" ? params.turnId : null,
      itemId: params && typeof params.itemId === "string" ? params.itemId : null,
    };

    this.pendingServerRequests.set(serverRequest.key, serverRequest);
    this.emit({
      type: "serverRequest",
      request: serverRequest,
    });
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (notification.method === "serverRequest/resolved" && isRecord(notification.params)) {
      const requestId = notification.params.requestId;
      if (typeof requestId === "string" || typeof requestId === "number") {
        this.pendingServerRequests.delete(serializeRequestId(requestId));
      }
    }

    this.emit({
      type: "notification",
      method: notification.method,
      params: notification.params,
    });
  }

  private async handleChildExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.lastExit = {
      code,
      signal,
    };

    this.child = null;
    this.closeReaders();
    this.rejectAllPending(new Error("Codex app-server exited."));
    this.pendingServerRequests.clear();
    this.setStatus("disconnected");
  }

  private rejectAllPending(error: unknown): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }

    this.pendingRequests.clear();
  }

  private destroyCurrentChild(): void {
    const child = this.child;
    this.child = null;
    this.closeReaders();

    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
  }

  private closeReaders(): void {
    this.stdoutReader?.close();
    this.stderrReader?.close();
    this.stdoutReader = null;
    this.stderrReader = null;
  }

  private pushStderr(line: string): void {
    this.stderrTail.push(line);
    if (this.stderrTail.length > STDERR_TAIL_LIMIT) {
      this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_LIMIT);
    }
  }

  private setStatus(status: AppServerStatus): void {
    this.status = status;
    this.emit({
      type: "backendStatus",
      payload: this.getSnapshot(),
    });
  }

  private emit(event: BrowserEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private isReady(): boolean {
    return this.status === "ready";
  }
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    !("method" in value) &&
    ("result" in value || "error" in value)
  );
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    (typeof value.id === "string" || typeof value.id === "number") &&
    typeof value.method === "string"
  );
}

function isJsonRpcNotification(value: unknown): value is JsonRpcNotification {
  return isRecord(value) && !("id" in value) && typeof value.method === "string";
}
