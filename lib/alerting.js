const { logger } = require("./logger");

const notifyCritical = async (message, meta = {}) => {
  const webhookUrl = String(process.env.ALERT_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message,
        timestamp: new Date().toISOString(),
        meta,
      }),
    });

    if (!response.ok) {
      logger.warn("critical_alert_failed", {
        status: response.status,
        statusText: response.statusText,
      });
    }
  } catch (error) {
    logger.warn("critical_alert_failed", { error: error.message });
  }
};

module.exports = { notifyCritical };
