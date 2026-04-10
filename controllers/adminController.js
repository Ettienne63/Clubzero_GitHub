const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("../lib/logger");

const INVITE_EXPIRY_HOURS = 48;
const ADMIN_ROLES = new Set(["ADMIN", "OWNER", "STAFF"]);
const MANAGEABLE_ROLES = new Set(["ADMIN", "STAFF", "USER"]);
const STOCKIST_STATUSES = new Set(["NEW", "CONTACTED", "CLOSED"]);

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

const buildBaseUrl = (req) => {
  const fromEnv = (process.env.PUBLIC_BASE_URL || "").trim();
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, "");
  }
  const isHttps = req.get("x-forwarded-proto") === "https";
  return `${isHttps ? "https" : req.protocol}://${req.get("host")}`;
};

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createInviteToken = () => crypto.randomBytes(32).toString("hex");

const logAudit = async ({ action, actorUserId, targetUserId, metadata }) => {
  try {
    await prisma.authAuditLog.create({
      data: {
        action,
        actorUserId: actorUserId || null,
        targetUserId: targetUserId || null,
        metadata: metadata || undefined,
      },
    });
  } catch (error) {
    logger.warn("audit_log_failed", { action, error: error.message });
  }
};

const sendInviteEmail = async ({ to, inviteUrl, role }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
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

  await transporter.sendMail({
    from: smtp.from,
    to,
    subject: "Club Zero admin invite",
    text: [
      "You have been invited to access the Club Zero admin portal.",
      `Role: ${role}`,
      `Accept invite: ${inviteUrl}`,
      "",
      `This link expires in ${INVITE_EXPIRY_HOURS} hours.`,
    ].join("\n"),
  });

  return { sent: true };
};

const createAndDeliverInvite = async ({
  req,
  email,
  role,
  actorUserId,
  auditAction,
}) => {
  const token = createInviteToken();
  const tokenHash = hashToken(token);
  const tokenPreview = token.slice(0, 10);
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.adminInvite.updateMany({
    where: {
      email,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  const invite = await prisma.adminInvite.create({
    data: {
      email,
      role,
      tokenHash,
      tokenPreview,
      expiresAt,
      invitedByUserId: Number.isInteger(actorUserId) ? actorUserId : null,
    },
  });

  const inviteUrl = `${buildBaseUrl(req)}/auth/invite/${token}`;
  const emailResult = await sendInviteEmail({ to: email, inviteUrl, role });

  await logAudit({
    action: auditAction,
    actorUserId,
    metadata: { email, role, inviteId: invite.id },
  });

  return { invite, inviteUrl, emailResult };
};

exports.getAdminTeamPage = async (req, res) => {
  const users = await prisma.user.findMany({
    where: {
      role: { in: ["OWNER", "ADMIN", "STAFF"] },
    },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });

  const now = new Date();
  const invites = await prisma.adminInvite.findMany({
    where: {
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });

  return res.render("admin-team", {
    users,
    invites,
    inviteLink: req.query.inviteLink || null,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.postAdminInvite = async (req, res) => {
  const email = (req.body.email || "").toString().trim().toLowerCase();
  const role = (req.body.role || "").toString().trim().toUpperCase();
  const actorUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!email) {
    return res.redirect(
      `/admin/team?error=${encodeURIComponent("Email is required.")}`,
    );
  }
  if (!ADMIN_ROLES.has(role) || role === "OWNER") {
    return res.redirect(
      `/admin/team?error=${encodeURIComponent(
        "Role must be ADMIN or STAFF.",
      )}`,
    );
  }

  const { inviteUrl, emailResult } = await createAndDeliverInvite({
    req,
    email,
    role,
    actorUserId,
    auditAction: "admin_invite_created",
  });

  const successMessage = emailResult.sent
    ? `Invite sent to ${email}.`
    : `Invite created for ${email}. Email not sent (SMTP not configured).`;

  const inviteLinkParam =
    emailResult.sent ? "" : `&inviteLink=${encodeURIComponent(inviteUrl)}`;
  return res.redirect(
    `/admin/team?success=${encodeURIComponent(successMessage)}${inviteLinkParam}`,
  );
};

exports.resendAdminInvite = async (req, res) => {
  const inviteId = Number.parseInt(req.params.id, 10);
  const actorUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!Number.isInteger(inviteId)) {
    return res.redirect(`/admin/team?error=Invalid+invite+id`);
  }

  const sourceInvite = await prisma.adminInvite.findFirst({
    where: {
      id: inviteId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, email: true, role: true },
  });

  if (!sourceInvite) {
    return res.redirect(`/admin/team?error=Invite+not+found+or+expired`);
  }

  if (!ADMIN_ROLES.has(sourceInvite.role) || sourceInvite.role === "OWNER") {
    return res.redirect(`/admin/team?error=Invite+role+is+invalid`);
  }

  const { inviteUrl, emailResult } = await createAndDeliverInvite({
    req,
    email: sourceInvite.email,
    role: sourceInvite.role,
    actorUserId,
    auditAction: "admin_invite_resent",
  });

  const successMessage = emailResult.sent
    ? `Invite resent to ${sourceInvite.email}.`
    : `Invite recreated for ${sourceInvite.email}. Email not sent (SMTP not configured).`;
  const inviteLinkParam =
    emailResult.sent ? "" : `&inviteLink=${encodeURIComponent(inviteUrl)}`;

  return res.redirect(
    `/admin/team?success=${encodeURIComponent(successMessage)}${inviteLinkParam}`,
  );
};

exports.revokeAdminInvite = async (req, res) => {
  const inviteId = Number.parseInt(req.params.id, 10);
  const actorUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!Number.isInteger(inviteId)) {
    return res.redirect(`/admin/team?error=Invalid+invite+id`);
  }

  const invite = await prisma.adminInvite.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  });

  await logAudit({
    action: "admin_invite_revoked",
    actorUserId,
    metadata: { email: invite.email, role: invite.role, inviteId: invite.id },
  });

  return res.redirect(`/admin/team?success=Invite+revoked`);
};

exports.updateUserRole = async (req, res) => {
  const targetUserId = Number.parseInt(req.params.id, 10);
  const role = (req.body.role || "").toString().trim().toUpperCase();
  const actorUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!Number.isInteger(targetUserId)) {
    return res.redirect(`/admin/team?error=Invalid+user+id`);
  }
  if (Number.isInteger(actorUserId) && targetUserId === actorUserId) {
    return res.redirect(`/admin/team?error=You+cannot+change+your+own+role`);
  }

  if (!MANAGEABLE_ROLES.has(role)) {
    return res.redirect(
      `/admin/team?error=${encodeURIComponent("Invalid role.")}`,
    );
  }

  if (role === "OWNER") {
    return res.redirect(`/admin/team?error=Owner+role+cannot+be+assigned.`);
  }

  const updatedUser = await prisma.user.update({
    where: { id: targetUserId },
    data: { role },
  });

  await logAudit({
    action: "admin_role_updated",
    actorUserId,
    targetUserId,
    metadata: { role },
  });

  return res.redirect(
    `/admin/team?success=${encodeURIComponent(
      `Updated ${updatedUser.email} to ${role}.`,
    )}`,
  );
};

exports.revokeUserAccess = async (req, res) => {
  const targetUserId = Number.parseInt(req.params.id, 10);
  const actorUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!Number.isInteger(targetUserId)) {
    return res.redirect(`/admin/team?error=Invalid+user+id`);
  }
  if (Number.isInteger(actorUserId) && targetUserId === actorUserId) {
    return res.redirect(`/admin/team?error=You+cannot+revoke+your+own+access`);
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, role: true },
  });

  if (!targetUser) {
    return res.redirect(`/admin/team?error=User+not+found`);
  }

  if (String(targetUser.role || "").toUpperCase() === "OWNER") {
    return res.redirect(`/admin/team?error=Owner+access+cannot+be+revoked`);
  }

  await prisma.user.update({
    where: { id: targetUserId },
    data: { role: "USER" },
  });

  await logAudit({
    action: "admin_access_revoked",
    actorUserId,
    targetUserId,
    metadata: { previousRole: targetUser.role },
  });

  return res.redirect(
    `/admin/team?success=${encodeURIComponent(
      `Removed admin access for ${targetUser.email}.`,
    )}`,
  );
};

exports.getAdminStockistsPage = async (req, res) => {
  const stockistRequests = await prisma.stockistRequest.findMany({
    orderBy: { createdAt: "desc" },
  });

  return res.render("admin-stockists", {
    stockistRequests,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateStockistStatus = async (req, res) => {
  const requestId = Number.parseInt(req.params.id, 10);
  const status = (req.body.status || "").toString().trim().toUpperCase();

  if (!Number.isInteger(requestId)) {
    return res.redirect(`/admin?error=Invalid+stockist+request+id`);
  }

  if (!STOCKIST_STATUSES.has(status)) {
    return res.redirect(`/admin?error=Invalid+status`);
  }

  await prisma.stockistRequest.update({
    where: { id: requestId },
    data: { status },
  });

  return res.redirect(`/admin/stockists?success=Stockist+request+updated`);
};
