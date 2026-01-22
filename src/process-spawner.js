const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { OutputParser } = require('./output-parser')

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/home/ubuntu/workspace'
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

class ClaudeProcessSpawner extends EventEmitter {
  constructor(sessionId, model, workingDirectory = WORKSPACE_DIR) {
    super()
    this.sessionId = sessionId
    this.model = model
    this.workingDirectory = workingDirectory
    this.process = null
    this.parser = new OutputParser(sessionId)
    this.isRunning = false
    this.outputBuffer = ''
  }

  /**
   * Spawn Claude Code CLI process
   */
  start() {
    if (this.isRunning) {
      throw new Error('Process already running')
    }

    // Validate API key is present
    if (!ANTHROPIC_API_KEY) {
      const error = new Error('ANTHROPIC_API_KEY environment variable is not set')
      this.emit('process_error', {
        type: 'error',
        message: error.message,
        source: 'config',
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
      return null
    }

    const args = ['--dangerously-skip-permissions']

    // Add model if specified
    if (this.model) {
      args.push('--model', this.model)
    }

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY,
      TERM: 'xterm-256color',
      COLUMNS: '120',
      LINES: '40'
    }

    console.log('[ClaudeProcessSpawner] Starting claude with args:', args)
    console.log('[ClaudeProcessSpawner] Working directory:', this.workingDirectory)
    console.log('[ClaudeProcessSpawner] API key present:', !!ANTHROPIC_API_KEY)

    this.process = spawn('claude', args, {
      cwd: this.workingDirectory,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false
    })

    this.isRunning = true

    // Handle stdout
    this.process.stdout.on('data', (data) => {
      const text = data.toString()
      this.outputBuffer += text
      this._processBuffer()
    })

    // Handle stderr
    this.process.stderr.on('data', (data) => {
      const text = data.toString()
      // Emit stderr as error events
      this.emit('error_output', {
        type: 'event',
        event_type: 'error',
        data: { message: text, source: 'stderr' },
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
    })

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.isRunning = false
      this.emit('exit', {
        type: 'event',
        event_type: 'session_end',
        data: {
          exit_code: code,
          signal,
          reason: signal ? 'signal' : (code === 0 ? 'normal' : 'error')
        },
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
    })

    // Handle process errors
    this.process.on('error', (error) => {
      this.isRunning = false
      this.emit('process_error', {
        type: 'event',
        event_type: 'error',
        data: {
          message: error.message,
          stack: error.stack,
          source: 'process'
        },
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
    })

    return this.process
  }

  /**
   * Process output buffer and emit parsed events
   */
  _processBuffer() {
    // Parse the buffer for structured output
    const events = this.parser.parse(this.outputBuffer)

    for (const event of events) {
      this.emit('output', {
        type: 'event',
        ...event,
        session_id: this.sessionId,
        timestamp: new Date().toISOString()
      })
    }

    // Keep unparsed content in buffer
    this.outputBuffer = this.parser.getRemaining()
  }

  /**
   * Send input to Claude Code
   */
  write(input) {
    if (!this.process || !this.isRunning) {
      throw new Error('Process not running')
    }

    // Ensure input ends with newline
    const text = input.endsWith('\n') ? input : input + '\n'
    this.process.stdin.write(text)
  }

  /**
   * Send abort signal (Ctrl+C equivalent)
   */
  abort() {
    if (this.process && this.isRunning) {
      this.process.kill('SIGINT')
    }
  }

  /**
   * Kill the process
   */
  kill() {
    if (this.process) {
      this.process.kill('SIGTERM')
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.process && this.isRunning) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }
  }

  /**
   * Check if process is running
   */
  isActive() {
    return this.isRunning
  }
}

module.exports = { ClaudeProcessSpawner }
