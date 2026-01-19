require('dotenv').config()

const fastify = require('fastify')({ logger: true })
const websocket = require('@fastify/websocket')
const cors = require('@fastify/cors')

const { validateToken } = require('./auth')
const { getDb, initDb } = require('./db')
const { SessionManager } = require('./session-manager')
const { handleWebSocket } = require('./websocket-handler')

const PORT = process.env.PORT || 9622
const HOST = process.env.HOST || '0.0.0.0'

async function start() {
  // Register plugins
  await fastify.register(cors, {
    origin: true,
    credentials: true
  })

  await fastify.register(websocket, {
    options: {
      maxPayload: 1048576 // 1MB
    }
  })

  // Initialize database
  await initDb()

  // Initialize session manager
  const sessionManager = new SessionManager()

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    const db = getDb()
    try {
      await db.query('SELECT 1')
      return { status: 'healthy', timestamp: new Date().toISOString() }
    } catch (error) {
      reply.status(503)
      return { status: 'unhealthy', error: error.message }
    }
  })

  // WebSocket endpoint
  fastify.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, async (socket, request) => {
      // Extract and validate JWT from query params or headers
      const token = request.query.token ||
                    request.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Authentication required'
        }))
        socket.close(4001, 'Authentication required')
        return
      }

      let user
      try {
        user = await validateToken(token)
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'error',
          message: 'Invalid token'
        }))
        socket.close(4002, 'Invalid token')
        return
      }

      // Handle WebSocket connection
      await handleWebSocket(socket, user, sessionManager, request)
    })
  })

  // REST endpoints for session management
  fastify.get('/sessions', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      reply.status(401)
      return { error: 'Authentication required' }
    }

    let user
    try {
      user = await validateToken(token)
    } catch (error) {
      reply.status(401)
      return { error: 'Invalid token' }
    }

    const db = getDb()
    const result = await db.query(
      `SELECT * FROM claude_code.sessions
       WHERE user_id = $1
       ORDER BY started_at DESC
       LIMIT 50`,
      [user.sub]
    )
    return { data: result.rows }
  })

  fastify.get('/sessions/:sessionId', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      reply.status(401)
      return { error: 'Authentication required' }
    }

    let user
    try {
      user = await validateToken(token)
    } catch (error) {
      reply.status(401)
      return { error: 'Invalid token' }
    }

    const { sessionId } = request.params
    const db = getDb()
    const result = await db.query(
      `SELECT * FROM claude_code.sessions
       WHERE id = $1 AND user_id = $2`,
      [sessionId, user.sub]
    )

    if (result.rows.length === 0) {
      reply.status(404)
      return { error: 'Session not found' }
    }

    return { data: result.rows[0] }
  })

  fastify.get('/sessions/:sessionId/messages', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      reply.status(401)
      return { error: 'Authentication required' }
    }

    let user
    try {
      user = await validateToken(token)
    } catch (error) {
      reply.status(401)
      return { error: 'Invalid token' }
    }

    const { sessionId } = request.params
    const db = getDb()

    // Verify user owns the session
    const sessionResult = await db.query(
      `SELECT id FROM claude_code.sessions
       WHERE id = $1 AND user_id = $2`,
      [sessionId, user.sub]
    )

    if (sessionResult.rows.length === 0) {
      reply.status(404)
      return { error: 'Session not found' }
    }

    const result = await db.query(
      `SELECT * FROM claude_code.messages
       WHERE session_id = $1
       ORDER BY created_at ASC`,
      [sessionId]
    )

    return { data: result.rows }
  })

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...')
    await sessionManager.cleanup()
    await fastify.close()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  // Start server
  try {
    await fastify.listen({ port: PORT, host: HOST })
    fastify.log.info(`Claude Code Wrapper running on ${HOST}:${PORT}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
