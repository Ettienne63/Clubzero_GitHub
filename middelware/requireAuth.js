const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  const email = String(req.session.user.email || "").toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(email);

  if (!isAdmin) {
    return res.status(403).send("Access denied");
  }

  next();
};

module.exports = {
  requireAuth,
  requireAdmin,
};
