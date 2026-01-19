const { v4: uuidv4 } = require('uuid')
const { insertMessage, getUserSettings } = require('./db')
const { MessageAggregator } = require('./output-parser')

const HEARTBEAT_INTERVAL = 30000 // 30 seconds

/**
 * Handle WebSocket connection and message routing
 */
async function handleWebSocket(socket, user, sessionManager, request) {
  const userId = user.sub
  const projectRef = request.query.project_ref || process.env.PROJECT_REF

  // Set up heartbeat
  let heartbeatTimer = null
  let isAlive = true

  const startHeartbeat = () => {
    heartbeatTimer = setInterval(() => {
      if (!isAlive) {
        socket.close(4003, 'Connection timeout')
        return
      }
      isAlive = false
      socket.ping()
    }, HEARTBEAT_INTERVAL)
  }

  socket.on('pong', () => {
    isAlive = true
  })

  startHeartbeat()

  // Get user settings
  const settings = await getUserSettings(userId, projectRef)
  let currentSessionId = null
  let messageAggregator = null

  // Send welcome message
  socket.send(JSON.stringify({
    type: 'connected',
    user_id: userId,
    project_ref: projectRef,
    settings
  }))

  // Handle incoming messages
  socket.on('message', async (data) => {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch (e) {
      socket.send(JSON.stringify({
        type: 'error',
        message: 'Invalid JSON'
      }))
      return
    }

    switch (message.type) {
      case 'message':
        await handleUserMessage(message, socket, user, sessionManager, settings, currentSessionId, (id) => {
          currentSessionId = id
          messageAggregator = new MessageAggregator()
        })
        break

      case 'abort':
        await handleAbort(message, sessionManager, currentSessionId)
        break

      case 'ping':
        socket.send(JSON.stringify({ type: 'pong' }))
        break

      case 'end_session':
        if (currentSessionId) {
          await sessionManager.endSession(currentSessionId, 'user_ended')
          currentSessionId = null
        }
        break

      case 'new_session':
        // End current session if any
        if (currentSessionId) {
          await sessionManager.endSession(currentSessionId, 'new_session')
        }
        currentSessionId = null
        messageAggregator = null
        socket.send(JSON.stringify({
          type: 'session_cleared',
          timestamp: new Date().toISOString()
        }))
        break

      default:
        socket.send(JSON.stringify({
          type: 'error',
          message: `Unknown message type: ${message.type}`
        }))
    }
  })

  // Handle socket close
  socket.on('close', async () => {
    clearInterval(heartbeatTimer)
    await sessionManager.handleSocketDisconnect(socket)
  })

  // Handle socket error
  socket.on('error', (error) => {
    console.error('WebSocket error:', error)
  })
}

/**
 * Handle user message - create session if needed, send to Claude
 */
async function handleUserMessage(message, socket, user, sessionManager, settings, currentSessionId, setSessionId) {
  const userId = user.sub
  const projectRef = message.project_ref || process.env.PROJECT_REF
  const content = message.content

  if (!content || !content.trim()) {
    socket.send(JSON.stringify({
      type: 'error',
      message: 'Empty message content'
    }))
    return
  }

  // Create new session if needed
  let sessionId = currentSessionId || message.session_id
  let spawner

  if (!sessionId || !sessionManager.hasSession(sessionId)) {
    // Create new session
    try {
      const result = await sessionManager.startSession(
        userId,
        projectRef,
        message.model || settings.preferred_model,
        settings.working_directory,
        socket
      )
      sessionId = result.session.id
      spawner = result.spawner
      setSessionId(sessionId)

      // Notify client of new session
      socket.send(JSON.stringify({
        type: 'session_started',
        session_id: sessionId,
        model: result.session.model,
        working_directory: result.session.working_directory,
        timestamp: new Date().toISOString()
      }))

      // Start the Claude process
      spawner.start()

      // Set up event listeners
      setupSpawnerListeners(spawner, socket, sessionId)

    } catch (error) {
      socket.send(JSON.stringify({
        type: 'error',
        message: error.message
      }))
      return
    }
  } else {
    // Use existing session
    const session = sessionManager.getSession(sessionId)
    spawner = session.process
    sessionManager.resetTimeout(sessionId)
  }

  // Store user message in database
  await insertMessage(sessionId, 'user', content, 'user_message')

  // Send message indicator
  socket.send(JSON.stringify({
    type: 'message_received',
    session_id: sessionId,
    timestamp: new Date().toISOString()
  }))

  // Send to Claude process
  try {
    spawner.write(content)
  } catch (error) {
    socket.send(JSON.stringify({
      type: 'error',
      message: `Failed to send to Claude: ${error.message}`,
      session_id: sessionId
    }))
  }
}

/**
 * Set up event listeners for spawner
 */
function setupSpawnerListeners(spawner, socket, sessionId) {
  const aggregator = new MessageAggregator()

  spawner.on('output', async (event) => {
    // Send event to client
    socket.send(JSON.stringify(event))

    // Aggregate for storage
    aggregator.addEvent(event)
  })

  spawner.on('error_output', (event) => {
    socket.send(JSON.stringify(event))
    aggregator.addEvent({ event_type: 'error', data: event.data })
  })

  spawner.on('exit', async (event) => {
    socket.send(JSON.stringify(event))

    // Store aggregated assistant message
    const message = aggregator.finalize()
    if (message.content || message.tool_calls.length > 0) {
      await insertMessage(sessionId, 'assistant', message.content, 'assistant_response', {
        tool_calls: message.tool_calls,
        file_changes: message.file_changes,
        bash_commands: message.bash_commands,
        errors: message.errors
      })
    }
  })

  spawner.on('process_error', (event) => {
    socket.send(JSON.stringify(event))
  })
}

/**
 * Handle abort request
 */
async function handleAbort(message, sessionManager, currentSessionId) {
  const sessionId = message.session_id || currentSessionId
  if (!sessionId) return

  const session = sessionManager.getSession(sessionId)
  if (session && session.process) {
    session.process.abort()
  }
}

module.exports = { handleWebSocket }
