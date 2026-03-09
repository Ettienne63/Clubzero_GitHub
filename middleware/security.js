const crypto = require("crypto");
const { logger } = require("../lib/logger");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const createRateLimit = ({ windowMs, max, message, methods = ["POST"] }) => {
  const store = new Map();
  const allowedMethods = new Set(methods.map((method) => method.toUpperCase()));

  return (req, res, next) => {
    if (!allowedMethods.has(req.method.toUpperCase())) {
      return next();
    }

    const now = Date.now();
    const key = `${req.ip}:${req.baseUrl || ""}${req.path}`;
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).send(message);
    }

    entry.count += 1;
    return next();
  };
};

const requestLogger = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  const requestId = crypto.randomUUID();

  req.requestId = requestId;
  res.locals.requestId = requestId;

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info("http_request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip,
      userId: req.session?.user?.id || null,
    });
  });

  next();
};

const csrfProtection = (req, res, next) => {
  if (!req.session) {
    return next(new Error("Session middleware must run before CSRF protection."));
  }

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  res.locals.csrfToken = req.session.csrfToken;

  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  const candidate =
    req.body?._csrf ||
    req.get("X-CSRF-Token") ||
    req.get("csrf-token") ||
    "";
  const expected = req.session.csrfToken;

  if (!candidate || candidate.length !== expected.length) {
    return res.status(403).send("Invalid CSRF token.");
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(candidate),
    Buffer.from(expected),
  );

  if (!isValid) {
    return res.status(403).send("Invalid CSRF token.");
  }

  return next();
};

module.exports = {
  createRateLimit,
  csrfProtection,
  requestLogger,
};
