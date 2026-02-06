class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = options.status || 500;
    this.redirectTo = options.redirectTo || null;
    this.exposeMessage = options.exposeMessage || message;
  }
}

module.exports = AppError;
