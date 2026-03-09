const { prisma } = require("../prisma/lib/prisma");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { logger } = require("../lib/logger");
const APPROVED_AFFILIATE_STATUS = "APPROVED";
const PASSWORD_RESET_WINDOW_MS = 1000 * 60 * 60;

const normalizeAffiliateStatus = (value) =>
  (value || "").toString().trim().toUpperCase();

const buildSessionUser = (user, isAdmin) => {
  const affiliateProgramStatus = normalizeAffiliateStatus(
    user.affiliateProgramStatus,
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name || "",
    isAdmin,
    role: user.role || "USER",
    isAffiliate: affiliateProgramStatus === APPROVED_AFFILIATE_STATUS,
    affiliateProgramStatus: affiliateProgramStatus || "NONE",
    affiliateCode: user.affiliateCode || null,
  };
};

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
    isConfigured: Boolean(host && Number.isInteger(port) && user && pass),
  };
};

const hashResetToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const buildPasswordResetUrl = (req, token) =>
  `${req.protocol}://${req.get("host")}/auth/reset-password?token=${encodeURIComponent(token)}`;

const sendPasswordResetEmail = async ({ user, token, req }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
    logger.warn("password_reset_smtp_not_configured", { userId: user.id });
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

  const resetUrl = buildPasswordResetUrl(req, token);

  await transporter.sendMail({
    from: smtp.from,
    to: user.email,
    subject: "Reset your Club Zero password",
    text: [
      `Hi ${user.name || "there"},`,
      "",
      "We received a request to reset your Club Zero password.",
      `Reset your password here: ${resetUrl}`,
      "",
      "This link expires in 1 hour. If you did not request this, you can ignore this email.",
    ].join("\n"),
  });

  return true;
};

const getValidPasswordResetToken = async (token) => {
  const tokenHash = hashResetToken(token);

  return prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: true,
    },
  });
};

exports.getSignup = (req, res) => {
  res.render("auth/signup", {
    error: req.query.error || null,
    referralCode: req.query.ref || req.session?.refAffiliateCode || null,
  });
};

exports.postSignup = async (req, res) => {
  try {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const name = (req.body.name || "").trim();

    if (!email || !password || !name) {
      return res.status(400).send("Name, email, and password are required.");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const referralAffiliateUserId = Number.parseInt(
      req.session?.refAffiliateUserId,
      10,
    );

    let referredByAffiliateId = null;
    if (Number.isInteger(referralAffiliateUserId)) {
      const affiliateUser = await prisma.user.findUnique({
        where: { id: referralAffiliateUserId },
        select: { id: true, affiliateProgramStatus: true },
      });

      if (
        affiliateUser &&
        normalizeAffiliateStatus(affiliateUser.affiliateProgramStatus) ===
          APPROVED_AFFILIATE_STATUS
      ) {
        referredByAffiliateId = affiliateUser.id;
      }
    }

    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        referredByAffiliateId,
      },
    });
    return res.redirect("/auth/login");
  } catch (error) {
    if (error?.code === "P2002") {
      return res.redirect(
        `/auth/signup?error=${encodeURIComponent("An account with this email already exists.")}`,
      );
    }

    return res.redirect(
      `/auth/signup?error=${encodeURIComponent("Unable to sign up right now. Please try again.")}`,
    );
  }
};

exports.getLogin = (req, res) => {
  res.render("auth/login", {
    error: req.query.error || null,
    success: req.query.success || null,
  });
};

exports.getForgotPassword = (req, res) => {
  res.render("auth/forgot-password", {
    error: req.query.error || null,
    success: req.query.success || null,
  });
};

exports.postForgotPassword = async (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const successMessage =
    "If an account exists for that email, a password reset link has been sent.";

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return res.redirect(
        `/auth/forgot-password?success=${encodeURIComponent(successMessage)}`,
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_WINDOW_MS);

    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id },
    });

    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    try {
      await sendPasswordResetEmail({ user, token, req });
    } catch (error) {
      logger.warn("password_reset_email_failed", {
        userId: user.id,
        error: error.message,
      });
    }

    return res.redirect(
      `/auth/forgot-password?success=${encodeURIComponent(successMessage)}`,
    );
  } catch (error) {
    logger.warn("password_reset_request_failed", {
      email,
      error: error.message,
    });
    return res.redirect(
      `/auth/forgot-password?error=${encodeURIComponent("Unable to process your request right now. Please try again.")}`,
    );
  }
};

exports.getResetPassword = async (req, res) => {
  const token = (req.query.token || "").toString().trim();

  if (!token) {
    return res.render("auth/reset-password", {
      error: "This password reset link is invalid or has expired.",
      success: req.query.success || null,
      token: "",
      tokenValid: false,
    });
  }

  const resetToken = await getValidPasswordResetToken(token);

  return res.render("auth/reset-password", {
    error: req.query.error || null,
    success: req.query.success || null,
    token,
    tokenValid: Boolean(resetToken),
  });
};

exports.postLogin = async (req, res) => {
  try {
    const email = (req.body.email || "").trim();
    const password = req.body.password || "";
    const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      return res.redirect(
        `/auth/login?error=${encodeURIComponent("User not found.")}`,
      );
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.redirect(
        `/auth/login?error=${encodeURIComponent("Incorrect password.")}`,
      );
    }
    const userEmail = (user.email || "").toLowerCase().trim();
    req.session.user = {
      ...buildSessionUser(user, Boolean(adminEmail && userEmail === adminEmail)),
    };
    return req.session.save(() => {
      res.redirect("/");
    });
  } catch (_error) {
    return res.redirect(
      `/auth/login?error=${encodeURIComponent("Database connection failed. Please try again.")}`,
    );
  }
};

exports.postResetPassword = async (req, res) => {
  const token = (req.body.token || "").toString().trim();
  const password = req.body.password || "";

  try {
    const resetToken = await getValidPasswordResetToken(token);

    if (!resetToken) {
      return res.redirect(
        `/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("This password reset link is invalid or has expired.")}`,
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.deleteMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
        },
      }),
    ]);

    return res.redirect(
      `/auth/login?success=${encodeURIComponent("Your password has been reset. You can now log in.")}`,
    );
  } catch (error) {
    logger.warn("password_reset_complete_failed", {
      error: error.message,
    });
    return res.redirect(
      `/auth/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent("Unable to reset your password right now. Please try again.")}`,
    );
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
};
