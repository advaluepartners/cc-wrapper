const { createSession, updateSessionStatus } = require('./db')
const { ClaudeProcessSpawner } = require('./process-spawner')

const MAX_SESSIONS_PER_USER = parseInt(process.env.MAX_SESSIONS_PER_USER || '3')
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MS || '3600000') // 1 hour

class SessionManager {
  constructor() {
    // Map of sessionId -> { process, socket, userId, timer }
    this.activeSessions = new Map()
    // Map of userId -> Set of sessionIds
    this.userSessions = new Map()
  }

  /**
   * Get active session count for a user
   */
  getActiveSessionCount(userId) {
    const sessions = this.userSessions.get(userId)
    return sessions ? sessions.size : 0
  }

  /**
   * Check if user can create a new session
   */
  canCreateSession(userId) {
    return this.getActiveSessionCount(userId) < MAX_SESSIONS_PER_USER
  }

  /**
   * Create and start a new session
   */
  async startSession(userId, projectRef, model, workingDirectory, socket) {
    if (!this.canCreateSession(userId)) {
      throw new Error(`Max sessions (${MAX_SESSIONS_PER_USER}) reached for user`)
    }

    // Create session in database
    const session = await createSession(userId, projectRef, model, workingDirectory)
    const sessionId = session.id

    // Spawn Claude Code process
    const spawner = new ClaudeProcessSpawner(sessionId, model, workingDirectory)

    // Set up timeout timer
    const timer = setTimeout(() => {
      this.endSession(sessionId, 'timeout')
    }, SESSION_TIMEOUT_MS)

    // Store session info
    this.activeSessions.set(sessionId, {
      process: spawner,
      socket,
      userId,
      timer,
      projectRef,
      model
    })

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set())
    }
    this.userSessions.get(userId).add(sessionId)

    return { session, spawner }
  }

  /**
   * Get session info
   */
  getSession(sessionId) {
    return this.activeSessions.get(sessionId)
  }

  /**
   * Check if session exists and is active
   */
  hasSession(sessionId) {
    return this.activeSessions.has(sessionId)
  }

  /**
   * Reset session timeout
   */
  resetTimeout(sessionId) {
    const session = this.activeSessions.get(sessionId)
    if (session) {
      clearTimeout(session.timer)
      session.timer = setTimeout(() => {
        this.endSession(sessionId, 'timeout')
      }, SESSION_TIMEOUT_MS)
    }
  }

  /**
   * End a session
   */
  async endSession(sessionId, reason = 'normal') {
    const session = this.activeSessions.get(sessionId)
    if (!session) return

    // Clear timeout
    clearTimeout(session.timer)

    // Kill Claude process
    if (session.process) {
      session.process.kill()
    }

    // Notify socket if still connected
    if (session.socket && session.socket.readyState === 1) {
      session.socket.send(JSON.stringify({
        type: 'event',
        event_type: 'session_end',
        data: { reason },
        session_id: sessionId,
        timestamp: new Date().toISOString()
      }))
    }

    // Update database
    const status = reason === 'error' ? 'error' :
                   reason === 'abort' ? 'aborted' : 'completed'
    await updateSessionStatus(sessionId, status, { end_reason: reason })

    // Remove from tracking
    this.activeSessions.delete(sessionId)
    const userSessions = this.userSessions.get(session.userId)
    if (userSessions) {
      userSessions.delete(sessionId)
      if (userSessions.size === 0) {
        this.userSessions.delete(session.userId)
      }
    }

    return { sessionId, reason, status }
  }

  /**
   * Handle socket disconnect - end associated sessions
   */
  async handleSocketDisconnect(socket) {
    const sessionsToEnd = []

    for (const [sessionId, session] of this.activeSessions) {
      if (session.socket === socket) {
        sessionsToEnd.push(sessionId)
      }
    }

    for (const sessionId of sessionsToEnd) {
      await this.endSession(sessionId, 'disconnect')
    }
  }

  /**
   * Cleanup all sessions - called on shutdown
   */
  async cleanup() {
    const sessionIds = Array.from(this.activeSessions.keys())
    for (const sessionId of sessionIds) {
      await this.endSession(sessionId, 'shutdown')
    }
  }

  /**
   * Get all active sessions for a user
   */
  getUserActiveSessions(userId) {
    const sessionIds = this.userSessions.get(userId)
    if (!sessionIds) return []

    return Array.from(sessionIds).map(id => ({
      sessionId: id,
      ...this.activeSessions.get(id)
    }))
  }
}

module.exports = { SessionManager }
