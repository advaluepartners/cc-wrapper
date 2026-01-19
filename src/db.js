const { Pool } = require('pg')

let pool = null

/**
 * Initialize database connection pool
 */
async function initDb() {
  if (pool) return pool

  pool = new Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER || 'capitala_admin',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DATABASE || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  })

  // Test connection
  try {
    const client = await pool.connect()
    client.release()
    console.log('Database connected successfully')
  } catch (error) {
    console.error('Database connection failed:', error.message)
    throw error
  }

  return pool
}

/**
 * Get database pool instance
 */
function getDb() {
  if (!pool) {
    throw new Error('Database not initialized. Call initDb() first.')
  }
  return pool
}

/**
 * Close database connections
 */
async function closeDb() {
  if (pool) {
    await pool.end()
    pool = null
  }
}

/**
 * Create a new session in the database
 */
async function createSession(userId, projectRef, model, workingDirectory) {
  const result = await pool.query(
    `INSERT INTO claude_code.sessions
       (user_id, project_ref, model, working_directory, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING *`,
    [userId, projectRef, model, workingDirectory]
  )
  return result.rows[0]
}

/**
 * Update session status
 */
async function updateSessionStatus(sessionId, status, metadata = {}) {
  const endedAt = ['completed', 'aborted', 'error'].includes(status)
    ? 'now()'
    : null

  const query = endedAt
    ? `UPDATE claude_code.sessions
       SET status = $2, ended_at = now(), metadata = metadata || $3
       WHERE id = $1
       RETURNING *`
    : `UPDATE claude_code.sessions
       SET status = $2, metadata = metadata || $3
       WHERE id = $1
       RETURNING *`

  const result = await pool.query(query, [sessionId, status, JSON.stringify(metadata)])
  return result.rows[0]
}

/**
 * Update session token counts
 */
async function updateSessionTokens(sessionId, tokensIn, tokensOut, costUsd) {
  const result = await pool.query(
    `UPDATE claude_code.sessions
     SET total_tokens_in = total_tokens_in + $2,
         total_tokens_out = total_tokens_out + $3,
         total_cost_usd = total_cost_usd + $4
     WHERE id = $1
     RETURNING *`,
    [sessionId, tokensIn, tokensOut, costUsd]
  )
  return result.rows[0]
}

/**
 * Insert a message into the database
 */
async function insertMessage(sessionId, role, content, eventType, extras = {}) {
  const result = await pool.query(
    `INSERT INTO claude_code.messages
       (session_id, role, content, event_type, tool_calls, file_changes, bash_commands, errors, tokens_in, tokens_out, raw_output)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      sessionId,
      role,
      content,
      eventType,
      JSON.stringify(extras.tool_calls || []),
      JSON.stringify(extras.file_changes || []),
      JSON.stringify(extras.bash_commands || []),
      JSON.stringify(extras.errors || []),
      extras.tokens_in || null,
      extras.tokens_out || null,
      extras.raw_output || null
    ]
  )
  return result.rows[0]
}

/**
 * Get user settings
 */
async function getUserSettings(userId, projectRef) {
  const result = await pool.query(
    `SELECT * FROM claude_code.user_settings
     WHERE user_id = $1 AND project_ref = $2`,
    [userId, projectRef]
  )

  if (result.rows.length === 0) {
    // Return defaults if no settings exist
    return {
      user_id: userId,
      project_ref: projectRef,
      preferred_model: process.env.DEFAULT_MODEL || 'claude-sonnet-4-20250514',
      working_directory: process.env.WORKSPACE_DIR || '/home/ubuntu/workspace',
      auto_approve_safe_commands: false
    }
  }

  return result.rows[0]
}

/**
 * Update user settings
 */
async function updateUserSettings(userId, projectRef, settings) {
  const result = await pool.query(
    `INSERT INTO claude_code.user_settings
       (user_id, project_ref, preferred_model, working_directory, auto_approve_safe_commands)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, project_ref)
     DO UPDATE SET
       preferred_model = EXCLUDED.preferred_model,
       working_directory = EXCLUDED.working_directory,
       auto_approve_safe_commands = EXCLUDED.auto_approve_safe_commands,
       updated_at = now()
     RETURNING *`,
    [
      userId,
      projectRef,
      settings.preferred_model,
      settings.working_directory,
      settings.auto_approve_safe_commands
    ]
  )
  return result.rows[0]
}

module.exports = {
  initDb,
  getDb,
  closeDb,
  createSession,
  updateSessionStatus,
  updateSessionTokens,
  insertMessage,
  getUserSettings,
  updateUserSettings
}
