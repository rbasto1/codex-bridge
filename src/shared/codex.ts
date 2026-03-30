export type RequestId = string | number;

export type RpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type InitializeResponse = {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
};

export type AppServerStatus = "starting" | "ready" | "error" | "disconnected";

export type AppServerExit = {
  code: number | null;
  signal: string | null;
} | null;

export type BrowserServerRequest = {
  key: string;
  requestId: RequestId;
  method: string;
  params: Record<string, unknown> | null;
  receivedAt: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
};

export type BackendSnapshot = {
  status: AppServerStatus;
  initializeResponse: InitializeResponse | null;
  pendingServerRequests: BrowserServerRequest[];
  stderrTail: string[];
  lastExit: AppServerExit;
  pid: number | null;
};

export type BrowserEvent =
  | { type: "snapshot"; payload: BackendSnapshot }
  | { type: "backendStatus"; payload: BackendSnapshot }
  | { type: "notification"; method: string; params?: unknown }
  | { type: "serverRequest"; request: BrowserServerRequest };

export type ThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: Array<"waitingOnApproval" | "waitingOnUserInput"> };

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type UserInput =
  | { type: "text"; text: string; text_elements: Array<unknown> }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type ThreadItem = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export type Turn = {
  id: string;
  items: ThreadItem[];
  status: TurnStatus;
  error: unknown | null;
};

export type Thread = {
  id: string;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  status: ThreadStatus;
  path: string | null;
  cwd: string;
  cliVersion: string;
  source: unknown;
  agentNickname: string | null;
  agentRole: string | null;
  gitInfo: unknown | null;
  name: string | null;
  turns: Turn[];
};

export function serializeRequestId(requestId: RequestId): string {
  return typeof requestId === "number" ? `n:${requestId}` : `s:${requestId}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createTextInput(text: string): UserInput {
  return {
    type: "text",
    text,
    text_elements: [],
  };
}
