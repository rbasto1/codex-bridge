# Codex Web Build Plan

## Goal

Build a local-only web app for Codex.

The app must:

- run one local backend process that serves all projects and all sessions
- use the installed `codex` CLI, not the OpenAI SDK
- use `codex app-server` as the integration surface
- show saved Codex sessions for continuation
- allow renaming sessions
- render markdown and syntax highlighting
- allow switching between sessions and projects
- allow steering the agent during an active turn
- skip filesystem browsing, diff UI, and console UI for v1

## Product Shape

Two processes:

1. Local backend

- long-lived process on the user machine
- spawns exactly one `codex app-server --listen stdio://`
- owns the JSON-RPC session to app-server
- exposes a browser-friendly API over HTTP + WebSocket/SSE
- serves all projects and all sessions through the same backend

2. Web frontend

- connects only to the local backend
- never talks directly to `codex app-server`
- renders session list, thread transcript, streaming updates, approvals, and composer state

## Why This Architecture

- `codex app-server` is the rich client surface in this repo.
- It already supports `thread/list`, `thread/read`, `thread/resume`, `thread/name/set`, `turn/start`, `turn/steer`, `turn/interrupt`, and streamed `thread/*`, `turn/*`, `item/*` notifications.
- Browser-direct integration is the wrong boundary because stdio is the stable transport and websocket support in app-server is marked experimental.
- One backend process matches the persistence model in `~/.codex` and avoids spawning one Codex process per tab/project.

## Source Facts To Respect

- Use `codex app-server`, not `codex exec`, for the main integration.
- Handshake is required: `initialize` then `initialized`.
- `thread/read(includeTurns=true)` is replay-only.
- `thread/resume` is required for live attachment to a session.
- `turn/steer` requires `expectedTurnId` and only works on active regular turns.
- Session names are non-unique; the UI must use thread ids as canonical identifiers.
- TUI opts into `persistExtendedHistory`; this web app should too.

## Recommended Stack

Choose any reasonable stack, but optimize for speed and maintainability.

Recommended:

- Backend: Node.js + TypeScript
- Frontend: React + TypeScript
- Backend WebSocket transport to browser for live events
- Frontend markdown: `react-markdown`
- Syntax highlighting: `shiki` or `react-syntax-highlighter`

Reason:

- close to the existing `../claude-code` app stack
- easy child-process + JSONL handling for `codex app-server`
- easy browser event fanout

## Backend Responsibilities

### 1. App-server lifecycle

- Spawn `codex app-server --listen stdio://`
- Capture stdin/stdout/stderr
- Perform `initialize`
- Send `initialized`
- Track request ids and pending promises
- Parse server notifications and server-initiated requests
- Reconnect or fail loudly if the child exits

Backend should set a distinct client identity, for example:

- `clientInfo.name = "codex_web_local"`
- `clientInfo.title = "Codex Web Local"`
- `capabilities.experimentalApi = true`

Also set app-server session source explicitly if useful when spawning the CLI, for example:

- `codex app-server --session-source codex-web`

That helps separate these sessions from CLI/TUI sessions while still using the same storage.

### 2. Protocol bridge

Expose a thin API that mirrors app-server closely.

Suggested backend API:

- `GET /api/health`
- `GET /api/init`
- `POST /api/thread/start`
- `POST /api/thread/resume`
- `POST /api/thread/read`
- `POST /api/thread/list`
- `POST /api/thread/name/set`
- `POST /api/turn/start`
- `POST /api/turn/steer`
- `POST /api/turn/interrupt`
- `POST /api/server-request/respond`
- `WS /api/events`

The backend should keep the payloads close to Codex payloads instead of inventing a large custom abstraction.

### 3. Event fanout

Maintain a single stream from app-server and broadcast normalized events to connected browser tabs.

Events to forward at minimum:

- `thread/started`
- `thread/status/changed`
- `thread/name/updated`
- `thread/archived`
- `thread/unarchived`
- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoning/summaryTextDelta`
- `item/commandExecution/outputDelta`
- `serverRequest/resolved`
- top-level `error`

Do not hide app-server semantics too early. The frontend can build higher-level state from these events.

### 4. Server-initiated request handling

App-server can send JSON-RPC requests to the client for:

- command approval
- file change approval
- permission approval
- tool user input
- MCP elicitation

Even though v1 does not need diff or console UI, the web app still needs a minimal inline approval UI so turns do not deadlock.

Backend behavior:

- forward each server request to the browser over WS
- keep request id and thread id
- accept one browser response
- reply to app-server with the exact JSON-RPC response

Minimum v1 UI handling:

- command approval: show command + cwd + accept/decline/cancel
- file change approval: show summary text only, accept/decline/cancel
- tool user input: render prompt form
- everything unsupported: show a clear fallback error instead of silently ignoring

## Frontend Responsibilities

### 1. Layout

Use a 3-pane mental model:

1. Left sidebar: sessions
2. Optional top project filter/switcher
3. Main pane: transcript + composer

No filesystem tree, diff pane, or terminal pane in v1.

### 2. Session list

Load with `thread/list`.

Render for each thread:

- `id`
- `name` if present, else `preview`
- `updatedAt`
- `cwd`
- `source`
- `status`

Required UX:

- filter by project/cwd
- search locally by `name`, `preview`, `cwd`
- resume a thread live
- read a thread for replay
- rename a thread

Important:

- use `thread.id` as the stable key
- do not rely on names being unique

### 3. Project switching

Treat project switching as selecting a different `cwd` context.

Suggested behavior:

- extract project choices from observed thread `cwd`s plus a manual "Open project" input
- when starting a new thread, require choosing a cwd
- when resuming an existing thread, default to the thread's stored `cwd`
- if the user wants to continue in a different cwd, make it explicit in the UI

Do not silently reuse the currently visible project if the thread belongs to another cwd.

### 4. Transcript model

Transcript rendering should be built from `thread/read(includeTurns=true)` plus live events.

Rules:

- `thread/read(includeTurns=true)` seeds full replay state
- `thread/resume` establishes live attachment
- if the user opens a historical thread without resuming it, keep the pane replay-only
- if the user resumes it, switch to live mode

Represent item types at minimum:

- `userMessage`
- `agentMessage`
- `reasoning`
- `plan`
- `commandExecution`
- `fileChange`
- `contextCompaction`
- review mode items if they appear

### 5. Markdown and code rendering

For `agentMessage.text`:

- render as markdown
- support fenced code blocks
- syntax highlight code fences
- preserve streaming behavior while deltas arrive

Implementation guidance:

- maintain a text buffer per `itemId` for `item/agentMessage/delta`
- render progressively as markdown
- avoid expensive full-page rerenders on every token
- debounce or segment rendering if needed

### 6. Composer behavior

Composer rules:

- if no active regular turn: submit with `turn/start`
- if an active regular turn exists: submit with `turn/steer`
- include the current active `turnId` as `expectedTurnId`
- disable steer if the active turn is non-steerable
- show a stop button wired to `turn/interrupt`

This is the key differentiator versus the Claude app.

### 7. Approval UI

Inline pending approval cards in the transcript.

Minimum controls:

- accept
- decline
- cancel

Display enough context to make the request understandable, but do not build full diff tooling in v1.

## Canonical Client Flows

### Startup

1. Start backend
2. Backend spawns `codex app-server`
3. Backend performs `initialize` / `initialized`
4. Frontend loads init info and opens event socket
5. Frontend requests initial session list

### Open historical session replay-only

1. Frontend calls `thread/read` with `includeTurns=true`
2. Frontend renders transcript
3. No live updates expected

### Resume session live

1. Frontend calls `thread/resume`
2. Frontend marks session as live-attached
3. Frontend listens for streamed notifications for that thread
4. Composer sends `turn/start` or `turn/steer`

### Start new session

1. User selects project/cwd
2. Frontend calls `thread/start`
3. Backend opts into `persistExtendedHistory`
4. Frontend receives `thread/started`
5. User sends first prompt with `turn/start`

### Steer active turn

1. Frontend tracks active `turnId`
2. User submits follow-up input during generation
3. Frontend calls `turn/steer({ threadId, expectedTurnId, input })`
4. Transcript continues in the same turn

### Rename session

1. User edits thread title
2. Frontend calls `thread/name/set`
3. Frontend updates on response and/or `thread/name/updated`

## Data Model In Frontend

Keep normalized stores keyed by ids.

Suggested state buckets:

- `threadsById`
- `threadOrder`
- `turnsById`
- `itemsById`
- `activeThreadId`
- `activeTurnIdByThreadId`
- `liveAttachedThreadIds`
- `pendingServerRequestsById`
- `streamBuffersByItemId`

Derived state:

- current project/cwd
- current thread mode: replay vs live
- whether composer should use `turn/start` or `turn/steer`
- whether a thread is waiting on approval or user input

## Milestones

### Milestone 1: Backend bridge

Deliver:

- local backend process
- spawns `codex app-server`
- initialize handshake
- request/response correlation
- WebSocket event broadcast
- raw forwarding of app-server notifications and server requests

Acceptance:

- can call `thread/list`
- can call `thread/read`
- can call `thread/resume`
- can observe `turn/*` and `item/*` events in browser devtools

### Milestone 2: Session browser

Deliver:

- sidebar session list
- search/filter by cwd/name/preview
- replay historical thread via `thread/read(includeTurns=true)`
- rename via `thread/name/set`

Acceptance:

- existing Codex sessions from `~/.codex` are visible
- renamed sessions persist across reloads

### Milestone 3: Live conversation

Deliver:

- start new thread
- resume live thread
- send prompt with `turn/start`
- render streaming assistant markdown
- stop with `turn/interrupt`

Acceptance:

- can start a new session for a chosen project
- can continue an existing session live
- streamed text appears incrementally

### Milestone 4: Steering

Deliver:

- detect active regular turn
- send mid-turn messages with `turn/steer`
- keep transcript coherent in same turn

Acceptance:

- user can inject guidance while the model is still working
- no new turn is created when steering succeeds

### Milestone 5: Minimal approvals

Deliver:

- inline approval cards
- response path for server-initiated requests
- minimal tool input forms

Acceptance:

- turns requiring approval can complete from the web UI

### Milestone 6: Polish

Deliver:

- reconnect behavior for browser refresh
- better project switch UX
- performance tuning for long transcripts
- empty states and error states

## Implementation Notes

### Keep one app-server child

Do not spawn one child per browser tab or per project.

Use one process and multiplex threads in your backend.

### Prefer exact app-server payloads

Do not invent a parallel conversation model unless necessary.

The closer your backend stays to app-server payloads, the easier upgrades will be.

### Resume vs read matters

Use:

- `thread/read(includeTurns=true)` for historical transcript hydration
- `thread/resume` for a real live subscription

Do not treat them as interchangeable.

### Opt into richer history

When starting/resuming/forking through the backend, set experimental `persistExtendedHistory: true` so later replay is better.

### Use ids, not names

Thread names are user-facing labels only.

Canonical identity is `thread.id`.

### Handle app-server exit explicitly

If the app-server child exits:

- broadcast a backend-disconnected event to browsers
- expose stderr tail for debugging
- provide a manual restart action

### Keep v1 intentionally narrow

Do not build:

- file tree
- diff inspector
- terminal emulator
- background shell management
- realtime audio

Those can come later.

## Suggested First Tasks For The Agent

1. Scaffold backend and frontend apps in `../codex-web`
2. Implement `codex app-server` stdio bridge with handshake
3. Expose `thread/list`, `thread/read`, `thread/resume`, `thread/name/set`, `turn/start`, `turn/steer`, `turn/interrupt`
4. Implement browser WebSocket event stream
5. Build session sidebar and transcript viewer
6. Add markdown + syntax highlighting
7. Add live composer with start/steer/interrupt behavior
8. Add minimal approval UI
9. Test against real saved sessions in `~/.codex`

## Definition Of Done For V1

- one local backend serves all browser tabs, projects, and sessions
- app uses `codex app-server` through the installed CLI
- historical sessions are listed and can be opened
- sessions can be renamed
- markdown renders correctly with syntax highlighting
- user can switch between projects and sessions cleanly
- user can continue a session and steer during an active turn
- approval-required turns are usable from the web UI
- no OpenAI SDK dependency is used for the conversation engine
