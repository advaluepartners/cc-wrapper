/**
 * Simple logger utility for Claude Code Wrapper
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LOG_LEVELS.INFO

function formatMessage(level, message, meta = {}) {
  const timestamp = new Date().toISOString()
  const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ''
  return `[${timestamp}] [${level}] ${message}${metaStr}`
}

const logger = {
  debug(message, meta) {
    if (currentLevel <= LOG_LEVELS.DEBUG) {
      console.log(formatMessage('DEBUG', message, meta))
    }
  },

  info(message, meta) {
    if (currentLevel <= LOG_LEVELS.INFO) {
      console.log(formatMessage('INFO', message, meta))
    }
  },

  warn(message, meta) {
    if (currentLevel <= LOG_LEVELS.WARN) {
      console.warn(formatMessage('WARN', message, meta))
    }
  },

  error(message, meta) {
    if (currentLevel <= LOG_LEVELS.ERROR) {
      console.error(formatMessage('ERROR', message, meta))
    }
  }
}

module.exports = { logger, LOG_LEVELS }
