const express = require("express");
const path = require("path");
const session = require("express-session");
require("dotenv").config();

const pageRoutes = require("./routes/pageRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const cartRoutes = require("./routes/cartRoutes");

const app = express();
const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use((req, res, next) => {
  const user = req.session.user || null;
  const email = user ? String(user.email || "").toLowerCase() : "";
  const isAdmin = ADMIN_EMAILS.includes(email);

  res.locals.user = user;
  res.locals.isAdmin = isAdmin;
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");

app.use("/", pageRoutes);
app.use("/auth", authRoutes);
app.use("/", adminRoutes);
app.use("/", cartRoutes);

app.use((err, req, res, _next) => {
  console.error(err);
  if (err.redirectTo) {
    return res.redirect(err.redirectTo);
  }
  const message = err.exposeMessage || "Something went wrong";
  if (req.method === "POST" && req.path.startsWith("/admin")) {
    return res.redirect(`/admin?error=${encodeURIComponent(message)}`);
  }
  res.status(err.status || 500);
  if (req.accepts("html")) {
    return res.send(message);
  }
  return res.json({ error: message });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
