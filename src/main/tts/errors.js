"use strict";

/**
 * An error with a stable `code` (and `params` for its message), so the app
 * can show it in the user's language. `message` is an English fallback.
 */
class TtsError extends Error {
  constructor(code, message, params = {}) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

module.exports = { TtsError };
