const REQUIRED_ENV_VARS = ["DATABASE_URL", "SESSION_SECRET"];

const assertEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter(
    (key) => !String(process.env[key] || "").trim(),
  );

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const sessionSecret = String(process.env.SESSION_SECRET || "");
  if (sessionSecret === "dev-secret" || sessionSecret.length < 24) {
    throw new Error(
      "SESSION_SECRET must be set to a strong value and cannot use the development fallback.",
    );
  }
};

const loadConfig = () => {
  const nodeEnv = String(process.env.NODE_ENV || "development").trim();
  const isProduction = nodeEnv === "production";

  assertEnv();

  return {
    nodeEnv,
    isProduction,
    port: Number.parseInt(process.env.PORT || "3000", 10) || 3000,
    databaseUrl: process.env.DATABASE_URL,
    dbSchema: String(process.env.DB_SCHEMA || "clubzero_setup").trim(),
    sessionSecret: process.env.SESSION_SECRET,
    trustProxy: String(process.env.TRUST_PROXY || "").trim(),
    uploadsDir: String(process.env.UPLOAD_DIR || "").trim(),
    alertWebhookUrl: String(process.env.ALERT_WEBHOOK_URL || "").trim(),
    sessionCookieName: String(process.env.SESSION_COOKIE_NAME || "clubzero.sid").trim(),
  };
};

module.exports = { loadConfig };
