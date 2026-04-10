const ADMIN_ROLES = new Set(["ADMIN", "OWNER"]);

const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }

  const role = String(req.session.user.role || "").toUpperCase();
  if (!req.session.user.isAdmin && !ADMIN_ROLES.has(role)) {
    return res.status(403).send("Forbidden: Admin access only");
  }
  next();
};

const requireOwner = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }

  const role = String(req.session.user.role || "").toUpperCase();
  if (role !== "OWNER") {
    return res.status(403).send("Forbidden: Owner access only");
  }
  next();
};

module.exports = { requireAdmin, requireOwner };
