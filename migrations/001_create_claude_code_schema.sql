-- Claude Code Wrapper Database Schema
-- Run this migration on the local PostgreSQL instance

-- Create schema
CREATE SCHEMA IF NOT EXISTS claude_code;

-- Sessions table - tracks Claude Code sessions
CREATE TABLE IF NOT EXISTS claude_code.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    project_ref TEXT NOT NULL,
    model TEXT DEFAULT 'claude-sonnet-4-20250514',
    working_directory TEXT DEFAULT '/home/ubuntu/workspace',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'aborted', 'error')),
    started_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    total_tokens_in INTEGER DEFAULT 0,
    total_tokens_out INTEGER DEFAULT 0,
    total_cost_usd DECIMAL(10,6) DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Messages table - stores all messages in a session
CREATE TABLE IF NOT EXISTS claude_code.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES claude_code.sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT,
    event_type TEXT,
    tool_calls JSONB DEFAULT '[]'::jsonb,
    file_changes JSONB DEFAULT '[]'::jsonb,
    bash_commands JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TIMESTAMPTZ DEFAULT now(),
    raw_output TEXT
);

-- User settings table - per-user per-project preferences
CREATE TABLE IF NOT EXISTS claude_code.user_settings (
    user_id UUID NOT NULL,
    project_ref TEXT NOT NULL,
    preferred_model TEXT DEFAULT 'claude-sonnet-4-20250514',
    working_directory TEXT DEFAULT '/home/ubuntu/workspace',
    auto_approve_safe_commands BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, project_ref)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON claude_code.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_ref ON claude_code.sessions(project_ref);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON claude_code.sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON claude_code.sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON claude_code.messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON claude_code.messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON claude_code.messages(created_at);

-- JSONB indexes for querying tool calls and file changes
CREATE INDEX IF NOT EXISTS idx_messages_tool_calls ON claude_code.messages USING GIN (tool_calls);
CREATE INDEX IF NOT EXISTS idx_messages_file_changes ON claude_code.messages USING GIN (file_changes);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION claude_code.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to sessions table
DROP TRIGGER IF EXISTS sessions_updated_at ON claude_code.sessions;
CREATE TRIGGER sessions_updated_at
    BEFORE UPDATE ON claude_code.sessions
    FOR EACH ROW
    EXECUTE FUNCTION claude_code.update_updated_at();

-- Apply trigger to user_settings table
DROP TRIGGER IF EXISTS user_settings_updated_at ON claude_code.user_settings;
CREATE TRIGGER user_settings_updated_at
    BEFORE UPDATE ON claude_code.user_settings
    FOR EACH ROW
    EXECUTE FUNCTION claude_code.update_updated_at();

-- Grant permissions to capitala_admin user
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'capitala_admin') THEN
        GRANT ALL ON SCHEMA claude_code TO capitala_admin;
        GRANT ALL ON ALL TABLES IN SCHEMA claude_code TO capitala_admin;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA claude_code TO capitala_admin;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA claude_code TO capitala_admin;
    END IF;
END $$;

-- Print success message
DO $$
BEGIN
    RAISE NOTICE 'Claude Code schema migration completed successfully';
END $$;
