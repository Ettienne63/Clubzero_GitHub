const requireAdmin = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect("/auth/login");
  }

  if (!req.session.user.isAdmin) {
    return res.status(403).send("Forbidden: Admin access only");
  }
  next();
};

module.exports = { requireAdmin };
