const { prisma } = require("../prisma/lib/prisma");
const nodemailer = require("nodemailer");

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

const sendContactNotification = async ({ name, email, message }) => {
  const smtp = getSmtpConfig();

  if (!smtp.isConfigured) {
    return false;
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

  await transporter.sendMail({
    from: smtp.from,
    to: smtp.to,
    subject: `New contact message from ${name}`,
    replyTo: email,
    text: `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`,
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
      console.error("Contact notification email failed:", error);
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
