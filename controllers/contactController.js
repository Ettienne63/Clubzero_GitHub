const { prisma } = require("../prisma/lib/prisma");
const nodemailer = require("nodemailer");
const { logger } = require("../lib/logger");

const getSmtpConfig = () => {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number.parseInt(process.env.SMTP_PORT || "", 10);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const to = (process.env.CONTACT_TO_EMAIL || "").trim();
  const from =
    (process.env.CONTACT_FROM_EMAIL || "").trim() || "no-reply@clubzero.local";

  return {
    host,
    port,
    secure,
    user,
    pass,
    to,
    from,
    isConfigured: Boolean(host && Number.isInteger(port) && user && pass && to),
  };
};

const buildContactEmail = ({ name, email, message, subject }) => ({
  subject: subject || `New contact message from ${name}`,
  text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
});

const sendContactNotification = async ({ name, email, message, subject }) => {
  const smtp = getSmtpConfig();

  if (!smtp.isConfigured) {
    return false;
  }

  const payload = buildContactEmail({ name, email, message, subject });
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.to,
    subject: payload.subject,
    replyTo: email,
    text: payload.text,
  });

  return true;
};

exports.getContact = (req, res) => {
  res.render("contact", {
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.postContact = async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const message = (req.body.message || "").trim();

  try {
    await prisma.contactMessage.create({
      data: {
        name,
        email,
        message,
      },
    });

    try {
      await sendContactNotification({ name, email, message });
    } catch (error) {
      logger.warn("contact_notification_failed", {
        email,
        error: error.message,
      });
    }

    return res.redirect(
      `/contact?success=${encodeURIComponent("Thanks! Your message has been received.")}`,
    );
  } catch (_error) {
    return res.redirect(
      `/contact?error=${encodeURIComponent("Unable to send your message right now. Please try again.")}`,
    );
  }
};

exports.postStockist = async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const businessName = (req.body.businessName || "").trim();
  const phone = (req.body.phone || "").trim();
  const city = (req.body.city || "").trim();
  const message = (req.body.message || "").trim();
  const composedMessage = [
    "Stockist request details:",
    `Business: ${businessName}`,
    `Phone: ${phone}`,
    `City: ${city}`,
    "",
    message || "No additional message provided.",
  ].join("\n");

  try {
    await prisma.stockistRequest.create({
      data: {
        name,
        email,
        businessName,
        phone,
        city,
        message: message || null,
      },
    });

    await prisma.contactMessage.create({
      data: {
        name,
        email,
        message: composedMessage,
      },
    });

    try {
      await sendContactNotification({
        name,
        email,
        message: composedMessage,
        subject: `New stockist request from ${businessName || name}`,
      });
    } catch (error) {
      logger.warn("stockist_notification_failed", {
        email,
        error: error.message,
      });
    }

    return res.redirect(
      `/store-locator?success=${encodeURIComponent("Thanks! Your stockist request has been received.")}`,
    );
  } catch (_error) {
    return res.redirect(
      `/store-locator?error=${encodeURIComponent("Unable to send your request right now. Please try again.")}`,
    );
  }
};
