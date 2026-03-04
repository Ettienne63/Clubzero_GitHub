const { prisma } = require("../prisma/lib/prisma");
const bcrypt = require("bcrypt");

exports.getSignup = (req, res) => {
  res.render("auth/signup", {
    error: req.query.error || null,
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

    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
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
  res.render("auth/login", { error: req.query.error || null });
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
      id: user.id,
      email: user.email,
      name: user.name || "",
      isAdmin: Boolean(adminEmail && userEmail === adminEmail),
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

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect("/auth/login");
  });
};
