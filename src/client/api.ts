import { isRecord, type BackendSnapshot, type RequestId, type RpcError, type Thread, type Turn } from "../shared/codex.js";

export type ThreadListResponse = {
  data: Thread[];
  nextCursor: string | null;
};

export type ThreadResponse = {
  thread: Thread;
};

export type ThreadStartResponse = ThreadResponse;
export type ThreadResumeResponse = ThreadResponse;

export type TurnStartResponse = {
  turn: Turn;
};

export type TurnSteerResponse = {
  turnId: string;
};

export class ApiError extends Error {
  constructor(readonly rpcError: RpcError) {
    super(rpcError.message);
  }
}

export async function fetchInit(): Promise<BackendSnapshot> {
  return requestJson<BackendSnapshot>("/api/init");
}

export async function restartServer(): Promise<BackendSnapshot> {
  return requestJson<BackendSnapshot>("/api/server/restart", {
    method: "POST",
  });
}

export async function listAllThreads(): Promise<Thread[]> {
  const threads: Thread[] = [];
  let cursor: string | null = null;

  do {
    const page: ThreadListResponse = await requestJson<ThreadListResponse>("/api/thread/list", {
      method: "POST",
      body: JSON.stringify({
        cursor,
        limit: 200,
        sortKey: "updated_at",
      }),
    });

    threads.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);

  return threads;
}

export async function readThread(threadId: string): Promise<ThreadResponse> {
  return requestJson<ThreadResponse>("/api/thread/read", {
    method: "POST",
    body: JSON.stringify({
      threadId,
      includeTurns: true,
    }),
  });
}

export async function resumeThread(threadId: string): Promise<ThreadResumeResponse> {
  return requestJson<ThreadResumeResponse>("/api/thread/resume", {
    method: "POST",
    body: JSON.stringify({
      threadId,
    }),
  });
}

export async function startThread(cwd: string): Promise<ThreadStartResponse> {
  return requestJson<ThreadStartResponse>("/api/thread/start", {
    method: "POST",
    body: JSON.stringify({
      cwd,
    }),
  });
}

export async function renameThread(threadId: string, name: string): Promise<void> {
  await requestJson("/api/thread/name/set", {
    method: "POST",
    body: JSON.stringify({
      threadId,
      name,
    }),
  });
}

export async function startTurn(threadId: string, input: unknown): Promise<TurnStartResponse> {
  return requestJson<TurnStartResponse>("/api/turn/start", {
    method: "POST",
    body: JSON.stringify({
      threadId,
      input,
    }),
  });
}

export async function steerTurn(
  threadId: string,
  expectedTurnId: string,
  input: unknown,
): Promise<TurnSteerResponse> {
  return requestJson<TurnSteerResponse>("/api/turn/steer", {
    method: "POST",
    body: JSON.stringify({
      threadId,
      expectedTurnId,
      input,
    }),
  });
}

export async function interruptTurn(threadId: string, turnId: string): Promise<void> {
  await requestJson("/api/turn/interrupt", {
    method: "POST",
    body: JSON.stringify({
      threadId,
      turnId,
    }),
  });
}

export async function respondToServerRequest(body: {
  requestId: RequestId;
  result?: unknown;
  error?: RpcError;
}): Promise<void> {
  await requestJson("/api/server-request/respond", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function requestJson<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.code === "number") {
      throw new ApiError(parsed.error as RpcError);
    }

    throw new Error(`Request failed with status ${response.status}.`);
  }

  return parsed as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
