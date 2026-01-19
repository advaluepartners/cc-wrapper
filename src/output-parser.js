/**
 * OutputParser - Parse Claude Code CLI output into structured events
 *
 * Claude Code outputs various types of content:
 * - Plain text responses
 * - Tool calls (Read, Write, Edit, Bash, etc.)
 * - Tool results
 * - File edits with diffs
 * - Bash command outputs
 * - Thinking/reasoning blocks
 * - Error messages
 */

class OutputParser {
  constructor(sessionId) {
    this.sessionId = sessionId
    this.remaining = ''
    this.currentBlock = null
    this.blockStack = []
  }

  /**
   * Parse output buffer into structured events
   * @param {string} buffer - Raw output buffer
   * @returns {Array} Array of parsed events
   */
  parse(buffer) {
    const events = []
    const fullBuffer = this.remaining + buffer

    // Split by lines for processing
    const lines = fullBuffer.split('\n')

    // Keep last incomplete line in remaining
    this.remaining = lines.pop() || ''

    for (const line of lines) {
      const event = this._parseLine(line)
      if (event) {
        events.push(event)
      }
    }

    return events
  }

  /**
   * Parse a single line
   */
  _parseLine(line) {
    // Tool call patterns
    const toolCallMatch = line.match(/^(?:⏺|●|▶|►)\s*(\w+)(?:\s+(.*))?$/)
    if (toolCallMatch) {
      return {
        event_type: 'tool_call',
        data: {
          tool_name: toolCallMatch[1],
          parameters: toolCallMatch[2] || '',
          status: 'started'
        }
      }
    }

    // Tool result success
    const toolSuccessMatch = line.match(/^(?:✓|✔|✅)\s*(.*)$/)
    if (toolSuccessMatch) {
      return {
        event_type: 'tool_result',
        data: {
          result: toolSuccessMatch[1],
          success: true
        }
      }
    }

    // Tool result error
    const toolErrorMatch = line.match(/^(?:✗|✘|❌|Error:)\s*(.*)$/)
    if (toolErrorMatch) {
      return {
        event_type: 'tool_result',
        data: {
          result: toolErrorMatch[1],
          success: false
        }
      }
    }

    // File edit patterns (diff-style)
    const filePathMatch = line.match(/^(?:Editing|Writing|Reading)\s+(.+)$/)
    if (filePathMatch) {
      return {
        event_type: 'file_edit',
        data: {
          file_path: filePathMatch[1],
          action: line.startsWith('Editing') ? 'edit' :
                  line.startsWith('Writing') ? 'write' : 'read'
        }
      }
    }

    // Diff lines
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return {
        event_type: 'diff_add',
        data: { content: line.substring(1) }
      }
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return {
        event_type: 'diff_remove',
        data: { content: line.substring(1) }
      }
    }

    // Bash command execution
    const bashMatch = line.match(/^(?:\$|›|>)\s*(.+)$/)
    if (bashMatch) {
      return {
        event_type: 'bash_command',
        data: {
          command: bashMatch[1],
          status: 'started'
        }
      }
    }

    // Thinking blocks
    const thinkingMatch = line.match(/^(?:Thinking|🤔|💭)(?::|\.\.\.)\s*(.*)$/)
    if (thinkingMatch) {
      return {
        event_type: 'thinking',
        data: { content: thinkingMatch[1] }
      }
    }

    // Cost/token info
    const costMatch = line.match(/(?:tokens?|cost).*?(\d+(?:,\d+)?)/i)
    if (costMatch) {
      return {
        event_type: 'usage',
        data: { raw: line }
      }
    }

    // Skip empty lines and decorative elements
    if (!line.trim() || line.match(/^[─═━┄┈╌]+$/) || line.match(/^[-=]+$/)) {
      return null
    }

    // Default: treat as text output
    return {
      event_type: 'text',
      data: { content: line }
    }
  }

  /**
   * Get remaining unparsed content
   */
  getRemaining() {
    return this.remaining
  }

  /**
   * Reset parser state
   */
  reset() {
    this.remaining = ''
    this.currentBlock = null
    this.blockStack = []
  }
}

/**
 * Aggregate parsed events into message-level structures
 */
class MessageAggregator {
  constructor() {
    this.currentMessage = null
    this.reset()
  }

  reset() {
    this.currentMessage = {
      content: '',
      tool_calls: [],
      file_changes: [],
      bash_commands: [],
      errors: [],
      thinking: []
    }
    this.currentTool = null
    this.currentFile = null
    this.currentBash = null
  }

  /**
   * Add event to current message
   */
  addEvent(event) {
    const { event_type, data } = event

    switch (event_type) {
      case 'text':
        this.currentMessage.content += data.content + '\n'
        break

      case 'tool_call':
        this.currentTool = {
          name: data.tool_name,
          parameters: data.parameters,
          status: data.status,
          result: null
        }
        this.currentMessage.tool_calls.push(this.currentTool)
        break

      case 'tool_result':
        if (this.currentTool) {
          this.currentTool.result = data.result
          this.currentTool.success = data.success
          this.currentTool = null
        }
        break

      case 'file_edit':
        this.currentFile = {
          file_path: data.file_path,
          action: data.action,
          additions: [],
          removals: []
        }
        this.currentMessage.file_changes.push(this.currentFile)
        break

      case 'diff_add':
        if (this.currentFile) {
          this.currentFile.additions.push(data.content)
        }
        break

      case 'diff_remove':
        if (this.currentFile) {
          this.currentFile.removals.push(data.content)
        }
        break

      case 'bash_command':
        this.currentBash = {
          command: data.command,
          output: '',
          exit_code: null
        }
        this.currentMessage.bash_commands.push(this.currentBash)
        break

      case 'thinking':
        this.currentMessage.thinking.push(data.content)
        break

      case 'error':
        this.currentMessage.errors.push({
          message: data.message,
          source: data.source
        })
        break
    }
  }

  /**
   * Finalize and return current message
   */
  finalize() {
    const message = { ...this.currentMessage }
    message.content = message.content.trim()
    this.reset()
    return message
  }
}

module.exports = { OutputParser, MessageAggregator }
