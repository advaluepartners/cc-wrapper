# Claude Code Wrapper

WebSocket wrapper service for Claude Code CLI on Capital A EC2 instances.

## Overview

This service spawns Claude Code CLI processes per-session and streams output via WebSocket to the Capital A Studio frontend.

## Architecture

```
┌─────────────┐     WebSocket      ┌─────────────────────┐
│   Studio    │ ◄───────────────► │  claude-code-wrapper │
│   Frontend  │                    │   (Port 9622)        │
└─────────────┘                    └──────────┬──────────┘
                                              │ spawn
                                              ▼
                                   ┌──────────────────────┐
                                   │   Claude Code CLI    │
                                   │   (per session)      │
                                   └──────────────────────┘
```

## Installation

### Prerequisites

- Node.js 20+
- PostgreSQL (local on EC2)
- Claude Code CLI (`@anthropic-ai/claude-code`)

### Setup on EC2

```bash
# Clone repo
cd /opt/advalue
git clone https://github.com/advaluepartners/cc-wrapper.git
cd claude-code-wrapper

# Configure environment
cp .env.example .env
nano .env  # Edit with your values

# Run setup (installs deps, runs migrations, creates systemd service)
./scripts/setup.sh

# Start service
sudo systemctl start cc-wrapper
sudo systemctl enable cc-wrapper
```

### Manual Migration

```bash
./scripts/migrate.sh
```

## Configuration

Environment variables (`.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 9622 | WebSocket server port |
| `HOST` | 0.0.0.0 | Server host |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `JWT_SECRET` | - | JWT validation secret |
| `POSTGRES_HOST` | localhost | PostgreSQL host |
| `POSTGRES_PORT` | 5432 | PostgreSQL port |
| `POSTGRES_USER` | capitala_admin | Database user |
| `POSTGRES_PASSWORD` | - | Database password |
| `POSTGRES_DATABASE` | postgres | Database name |
| `WORKSPACE_DIR` | /home/ubuntu/workspace | Claude working directory |
| `MAX_SESSIONS_PER_USER` | 3 | Max concurrent sessions per user |
| `SESSION_TIMEOUT_MS` | 3600000 | Session timeout (1 hour) |
| `DEFAULT_MODEL` | claude-sonnet-4-20250514 | Default Claude model |

## WebSocket Protocol

### Connect

```
wss://{project_ref}.cap.company:9622/ws?token={jwt}&project_ref={ref}
```

### Client → Server Messages

```json
// Send message
{ "type": "message", "content": "Hello Claude", "session_id": "uuid" }

// Abort current operation
{ "type": "abort", "session_id": "uuid" }

// End session
{ "type": "end_session" }

// Start new session
{ "type": "new_session" }

// Ping
{ "type": "ping" }
```

### Server → Client Events

```json
// Connection established
{ "type": "connected", "user_id": "uuid", "project_ref": "ref", "settings": {...} }

// Session started
{ "type": "session_started", "session_id": "uuid", "model": "...", "timestamp": "..." }

// Claude output event
{
  "type": "event",
  "event_type": "text|tool_call|tool_result|file_edit|bash_command|error|thinking|session_end",
  "data": {...},
  "session_id": "uuid",
  "timestamp": "ISO8601"
}

// Error
{ "type": "error", "message": "..." }

// Pong
{ "type": "pong" }
```

## REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/sessions` | GET | List user sessions |
| `/sessions/:id` | GET | Get session details |
| `/sessions/:id/messages` | GET | Get session messages |

## Database Schema

Three tables in `claude_code` schema:

- `sessions` - Chat session metadata
- `messages` - Individual messages with parsed tool_calls, file_changes, etc.
- `user_settings` - Per-user preferences

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run in production
npm start
```

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u cc-wrapper -f

# Verify PostgreSQL is running
sudo systemctl status postgresql

# Test database connection
psql -h localhost -U capitala_admin -d postgres -c "SELECT 1"
```

### WebSocket connection fails

1. Check firewall allows port 9622
2. Verify JWT_SECRET matches Studio config
3. Check ANTHROPIC_API_KEY is set

### Claude Code errors

```bash
# Test Claude CLI directly
claude --version
echo "Hello" | claude --dangerously-skip-permissions
```
