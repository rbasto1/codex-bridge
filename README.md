# Codex Bridge

Codex Bridge makes Codex accessible in the browser.

It runs a small local web server, launches `codex app-server` in the background, and gives you a chat UI for starting, resuming, and managing Codex sessions from anywhere you can reach the page, including mobile.

This is for developers who want:

- Codex in a browser instead of only in a terminal or desktop app
- Access from another device on the same network
- Access over a tunnel like cloudflared or ngrok
- Session continuity across desktop and mobile
- A simple self-hosted way to keep Codex reachable

## Additional features

- Mark sessions as "done" to indicate they are complete
- Tag sessions for better organization, eg. "needs testing", "in progress", etc.
- Project icons for easy visual identification and navigation
- Hide projects and sessions to declutter the interface
- Draft sessions: write prompts to be executed later

## What It Does

- Uses the Codex CLI interface with vscode for integration
- Starts and resumes Codex threads from the web UI
- Streams live updates over WebSockets
- Persists Codex-backed threads under your normal Codex home
- Supports approval flows surfaced by `codex app-server`

## Requirements

- Node.js 20+
- npm
- A working `codex` CLI available on your `PATH`
- A machine where Codex can run locally

Optional:

- `OPENAI_API_KEY` or `OPENROUTER_API_KEY` if you want automatic thread title generation
- A tunnel such as Cloudflare Tunnel or ngrok if you want remote/mobile access outside your LAN

## Quick Start

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4095` for Vite dev, or build and run the production server:

```bash
npm run build
npm start
```

Production serves the web app and API from `http://127.0.0.1:4095` by default.

## Configuration

Environment variables:

- `SERVER_PORT`: port for the production Node server
- `PORT`: fallback port if `SERVER_PORT` is unset
- `OPENAI_API_KEY`: enables automatic thread name generation and takes priority when both keys are set
- `OPENROUTER_API_KEY`: fallback for automatic thread name generation when `OPENAI_API_KEY` is unset

Default production port is `4095`.

## Exposing It On Your Network

If you just want access from another device on your LAN, bind the app behind whatever local reverse proxy or port forwarding setup you prefer, then open that host from your phone or tablet.

The browser client uses WebSockets at `/api/events`, so make sure your proxy or tunnel supports WebSocket upgrades.

## Exposing It Over A Tunnel

This repo does not manage tunneling for you. Run the app locally, then publish the local HTTP port with your tunnel tool of choice.

Typical targets:

- Dev mode: tunnel the Vite port you are using
- Production mode: tunnel `4095` or your configured `SERVER_PORT`

Examples:

```bash
# ngrok
ngrok http 4095

# cloudflared
cloudflared tunnel --url http://127.0.0.1:4095
```

Once the tunnel is up, open the generated URL from any device. That includes mobile, as long as the host machine can keep Codex running.

## Mobile Use

This project is useful when you want to:

- start a session at your desk
- continue monitoring it from your phone
- respond to approval prompts away from your laptop
- pick up the same Codex history from another browser

The Codex process still runs on the host machine. Your phone is just the client.

## Data And Persistence

- Codex session data stays under `~/.codex/projects`
- Project metadata for this UI also lives there
- Browser-only UI state is stored locally in the browser

If you move to a different browser or device, your Codex threads are still available from the host machine, but browser-local UI preferences and drafts will not follow automatically.

## Development

Available scripts:

- `npm run dev`: run server and client in watch mode
- `npm run build`: build client and server
- `npm start`: run the built server
- `npm run typecheck`: run TypeScript checks

## Notes

- The backend starts `codex app-server` as a child process
- The app expects the machine running the server to have access to your project directories
- If you expose this publicly, put real auth in front of it first. This repo currently focuses on access, not hardened multi-user security

## Status

Early-stage and intentionally narrow in scope: make Codex reachable over the web, locally or through a tunnel, with usable session continuity across devices.
