const nodemailer = require("nodemailer");
const { logger } = require("./logger");

const getSmtpConfig = () => {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number.parseInt(process.env.SMTP_PORT || "", 10);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from =
    (process.env.CONTACT_FROM_EMAIL || "").trim() || "no-reply@clubzero.local";

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    isConfigured: Boolean(host && port && user && pass),
  };
};

const sendEmail = async ({ to, subject, text, html, replyTo }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
    logger.warn("smtp_not_configured", { to, subject });
    return { sent: false, reason: "smtp_not_configured" };
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  try {
    await transporter.sendMail({
      from: smtp.from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
      ...(replyTo ? { replyTo } : {}),
    });
    return { sent: true };
  } catch (error) {
    logger.error("email_send_failed", { error: error.message, to, subject });
    return { sent: false, reason: "send_failed" };
  }
};

module.exports = {
  getSmtpConfig,
  sendEmail,
};
