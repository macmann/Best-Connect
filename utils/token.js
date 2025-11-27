const crypto = require('crypto');

function generateInterviewToken() {
  if (typeof crypto !== 'undefined' && crypto.randomBytes) {
    return crypto.randomBytes(16).toString('hex');
  }
  return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

module.exports = { generateInterviewToken };
