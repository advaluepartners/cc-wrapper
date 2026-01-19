# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

WebSocket wrapper service that bridges Capital A Studio frontend with Claude Code CLI. Spawns per-session Claude Code processes on EC2, streams output via WebSocket, and persists all interactions to PostgreSQL.

## Commands

```bash
npm start       # Production: node src/server.js
npm run dev     # Development: nodemon with hot-reload
npm run migrate # Run database migrations
```

## Architecture

```
Studio Frontend ◄──WebSocket──► cc-wrapper (port 9622) ──spawn──► Claude Code CLI
                                      │
                                      ▼
                                 PostgreSQL
                           (sessions, messages, user_settings)
```

**Core modules in `src/`:**
- `server.js` - Fastify setup, REST endpoints, graceful shutdown
- `websocket-handler.js` - Connection handling, message routing, heartbeat (30s ping/pong)
- `session-manager.js` - Session lifecycle, max sessions per user, timeout auto-cleanup
- `process-spawner.js` - Claude CLI spawning, stdio handling, event emission
- `output-parser.js` - Parses Claude output into structured events (tool_calls, file_edits, bash_commands)
- `db.js` - PostgreSQL pool, CRUD for sessions/messages/settings
- `auth.js` - JWT validation

**Data flow:** User message → WebSocket → spawn/write to Claude CLI → stdout parsed → events streamed back → persisted to DB

## Key Patterns

- **Event-driven:** Process spawner emits events, websocket handler streams to client
- **Session isolation:** Each user limited to MAX_SESSIONS_PER_USER concurrent sessions
- **Message aggregation:** Multiple parsed events aggregated into single assistant message before DB persist
- **Graceful shutdown:** Signal handlers clean up all sessions and close DB pool

## Environment Variables

Required: `ANTHROPIC_API_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`

Defaults: PORT=9622, WORKSPACE_DIR=/home/ubuntu/workspace, MAX_SESSIONS_PER_USER=3, SESSION_TIMEOUT_MS=3600000, DEFAULT_MODEL=claude-sonnet-4-20250514

## Database

Schema `claude_code` with tables: `sessions`, `messages`, `user_settings`. JSONB columns store tool_calls, file_changes, bash_commands. Migration at `migrations/001_create_claude_code_schema.sql`.

## WebSocket Protocol

Connect: `wss://{host}:9622/ws?token={jwt}&project_ref={ref}`

Client→Server: `message`, `abort`, `end_session`, `new_session`, `ping`
Server→Client: `connected`, `session_started`, `event` (text/tool_call/tool_result/file_edit/bash_command/error/thinking/session_end), `error`, `pong`
