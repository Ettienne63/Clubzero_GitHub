const bcrypt = require("bcrypt");
const asyncHandler = require("../utils/asyncHandler");
const userModel = require("../models/userModel");

const MIN_PASSWORD_LEN = 6;
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

exports.signup = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = userModel.normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  if (!name) {
    return res.redirect(
      "/signup?error=" + encodeURIComponent("Name is required"),
    );
  }
  if (!email) {
    return res.redirect(
      "/signup?error=" + encodeURIComponent("Email is required"),
    );
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return res.redirect(
      "/signup?error=" +
        encodeURIComponent("Password must be at least 6 characters"),
    );
  }

  const existing = await userModel.getByEmail(email);
  if (existing) {
    return res.redirect(
      "/signup?error=" + encodeURIComponent("Email already exists"),
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await userModel.create({
    name,
    email,
    passwordHash: hashedPassword,
  });

  res.redirect("/login");
});

exports.login = asyncHandler(async (req, res) => {
  const email = userModel.normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  const user = await userModel.getByEmail(email);
  if (!user) {
    return res.redirect(
      "/login?error=" + encodeURIComponent("Invalid credentials"),
    );
  }

  const isBcryptHash =
    typeof user.passwordHash === "string" && user.passwordHash.startsWith("$2");
  const isValid = isBcryptHash
    ? await bcrypt.compare(password, user.passwordHash)
    : password === user.passwordHash;
  if (!isValid) {
    return res.redirect(
      "/login?error=" + encodeURIComponent("Invalid credentials"),
    );
  }

  if (!isBcryptHash) {
    const newHash = await bcrypt.hash(password, 10);
    await userModel.updatePasswordByEmail(email, newHash);
  }

  req.session.user = { id: user.id, email: user.email, name: user.name };
  const isAdmin = ADMIN_EMAILS.includes(
    String(user.email || "").trim().toLowerCase(),
  );
  res.redirect(isAdmin ? "/admin" : "/");
});

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
};
