const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET

/**
 * Validate JWT token and return decoded user payload
 * @param {string} token - JWT token
 * @returns {Promise<object>} - Decoded user payload
 */
async function validateToken(token) {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    return decoded
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired')
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token')
    }
    throw error
  }
}

/**
 * Generate JWT token for testing/development
 * @param {object} payload - User payload
 * @param {string} expiresIn - Expiration time
 * @returns {string} - JWT token
 */
function generateToken(payload, expiresIn = '1h') {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET not configured')
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn })
}

module.exports = {
  validateToken,
  generateToken
}
