const express = require("express");
const path = require("path");
const fs = require("fs");
const env = require("dotenv");
const session = require("express-session");
const multer = require("multer");
const authRoutes = require("./routes/authRoutes");
const { requireAdmin } = require("./middleware/adminMiddleware");
const { asyncHandler } = require("./middleware/asyncHandler");
const {
  productValidationRules,
  productIdParamValidationRules,
  idParamValidationRules,
  contactValidationRules,
  validateRedirectToAdmin,
  validateRedirectToAdminAffiliate,
  validateRedirectToContact,
} = require("./middleware/validation");
const productController = require("./controllers/productController");
const orderController = require("./controllers/orderController");
const contactController = require("./controllers/contactController");

env.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const uploadsDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "public", "uploads");
const legacyUploadsDir = path.join(__dirname, "public", "uploads");

if (!fs.existsSync(uploadsDir)) {
  try {
    fs.mkdirSync(uploadsDir, { recursive: true });
  } catch (error) {
    if (error.code !== "EROFS") {
      throw error;
    }
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9_-]/g, "-");

    cb(
      null,
      `${Date.now()}-${safeBase}${path.extname(file.originalname).toLowerCase()}`,
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }
    return cb(new Error("Only image files are allowed."));
  },
});

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.use("/uploads", express.static(legacyUploadsDir));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 },
  }),
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

app.get("/", (_req, res) => res.render("home"));
app.get("/about", (_req, res) => res.render("about"));
app.get("/contact", contactController.getContact);
app.post(
  "/contact",
  contactValidationRules,
  validateRedirectToContact,
  asyncHandler(contactController.postContact),
);
app.get("/admin", requireAdmin, asyncHandler(productController.getAdminPage));
app.get(
  "/admin/affiliate",
  requireAdmin,
  asyncHandler(orderController.getAdminAffiliatePage),
);
app.post(
  "/admin/products",
  requireAdmin,
  upload.single("image"),
  productValidationRules,
  validateRedirectToAdmin,
  asyncHandler(productController.createProduct),
);
app.post(
  "/admin/products/:id/edit",
  requireAdmin,
  upload.single("image"),
  productIdParamValidationRules,
  productValidationRules,
  validateRedirectToAdmin,
  asyncHandler(productController.updateProduct),
);
app.post(
  "/admin/products/:id/delete",
  requireAdmin,
  productIdParamValidationRules,
  validateRedirectToAdmin,
  asyncHandler(productController.deleteProduct),
);
app.post(
  "/admin/products/:id/restore",
  requireAdmin,
  productIdParamValidationRules,
  validateRedirectToAdmin,
  asyncHandler(productController.restoreProduct),
);
app.post(
  "/admin/affiliate/:id/approve",
  requireAdmin,
  idParamValidationRules,
  validateRedirectToAdminAffiliate,
  asyncHandler(orderController.approveAffiliatePayout),
);
app.post(
  "/admin/affiliate/:id/pay",
  requireAdmin,
  idParamValidationRules,
  validateRedirectToAdminAffiliate,
  asyncHandler(orderController.markAffiliatePayoutPaid),
);
app.use("/auth", authRoutes);

app.use((error, _req, res, next) => {
  if (
    error instanceof multer.MulterError ||
    error.message === "Only image files are allowed."
  ) {
    return res.redirect(`/admin?error=${encodeURIComponent(error.message)}`);
  }

  return next(error);
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).send("Something went wrong. Please try again.");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
