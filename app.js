const express = require("express");
const path = require("path");
const fs = require("fs");
const helmet = require("helmet");
require("dotenv").config();
const session = require("express-session");
const multer = require("multer");
const authRoutes = require("./routes/authRoutes");
const { loadConfig } = require("./config/env");
const { notifyCritical } = require("./lib/alerting");
const { logger } = require("./lib/logger");
const { PostgresSessionStore } = require("./lib/pgSessionStore");
const { requireAdmin } = require("./middleware/adminMiddleware");
const { asyncHandler } = require("./middleware/asyncHandler");
const {
  createRateLimit,
  csrfProtection,
  requestLogger,
} = require("./middleware/security");
const {
  productValidationRules,
  productIdParamValidationRules,
  idParamValidationRules,
  contactValidationRules,
  validateRedirectToAdmin,
  validateRedirectToContact,
} = require("./middleware/validation");
const productController = require("./controllers/productController");
const orderController = require("./controllers/orderController");
const contactController = require("./controllers/contactController");
const { prisma } = require("./prisma/lib/prisma");
const APPROVED_AFFILIATE_STATUS = "APPROVED";

const config = loadConfig();

const app = express();
const uploadsDir = config.uploadsDir
  ? path.resolve(config.uploadsDir)
  : path.join(__dirname, "public", "uploads");
const legacyUploadsDir = path.join(__dirname, "public", "uploads");
const sessionStore = new PostgresSessionStore({
  connectionString: config.databaseUrl,
  schema: config.dbSchema,
  ttlMs: 1000 * 60 * 60 * 24,
});
const authRateLimit = createRateLimit({
  windowMs: 1000 * 60 * 15,
  max: 10,
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});
const contactRateLimit = createRateLimit({
  windowMs: 1000 * 60 * 10,
  max: 5,
  message: "Too many contact submissions. Please try again in 10 minutes.",
});
const checkoutRateLimit = createRateLimit({
  windowMs: 1000 * 60 * 15,
  max: 8,
  message: "Too many checkout attempts. Please try again in 15 minutes.",
});

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

if (config.trustProxy) {
  app.set("trust proxy", config.trustProxy === "true" ? 1 : config.trustProxy);
}

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.post(
  "/webhooks/paystack",
  express.raw({ type: "application/json" }),
  asyncHandler(orderController.handlePaystackWebhook),
);
app.use(express.json({ limit: "100kb" }));
app.use(requestLogger);
app.use("/uploads", express.static(uploadsDir));
app.use("/uploads", express.static(legacyUploadsDir));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
    },
  }),
);
app.use(csrfProtection);

const isPaystackTestMode = String(process.env.PAYSTACK_SECRET_KEY || "")
  .trim()
  .startsWith("sk_test_");

app.use((req, res, next) => {
  res.locals.isPaystackTestMode = isPaystackTestMode;
  return next();
});

app.use(async (req, _res, next) => {
  const referralCode = (req.query.ref || "").toString().trim().toUpperCase();

  if (!referralCode) {
    return next();
  }

  try {
    const affiliateUser = await prisma.user.findFirst({
      where: {
        affiliateCode: referralCode,
        affiliateProgramStatus: APPROVED_AFFILIATE_STATUS,
      },
      select: { id: true, affiliateCode: true },
    });

    if (affiliateUser) {
      if (req.session) {
        req.session.refAffiliateUserId = affiliateUser.id;
        req.session.refAffiliateCode = affiliateUser.affiliateCode;
      }

      await prisma.affiliateReferralClick.create({
        data: {
          affiliateUserId: affiliateUser.id,
          referralCode: affiliateUser.affiliateCode,
          sessionId: req.sessionID || null,
          landingPath: req.originalUrl || req.path || null,
          referrerUrl: req.get("referer") || null,
          ipAddress: req.ip || null,
          userAgent: req.get("user-agent") || null,
        },
      });
    }
  } catch (error) {
    logger.warn("referral_capture_failed", { error: error.message });
  }

  return next();
});

app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cartCount = 0;

  if (res.locals.user) {
    const affiliateProgramStatus = String(
      res.locals.user.affiliateProgramStatus || "",
    )
      .toUpperCase()
      .trim();
    const isAffiliate =
      affiliateProgramStatus === APPROVED_AFFILIATE_STATUS ||
      String(res.locals.user.role || "").toUpperCase().trim() === "AFFILIATE";

    res.locals.user.isAffiliate = isAffiliate;
    if (req.session?.user) {
      req.session.user.isAffiliate = isAffiliate;
      if (!req.session.user.affiliateProgramStatus && affiliateProgramStatus) {
        req.session.user.affiliateProgramStatus = affiliateProgramStatus;
      }
    }
  }

  const userId = Number.parseInt(req.session?.user?.id, 10);
  const isAdmin = Boolean(req.session?.user?.isAdmin);

  if (!Number.isInteger(userId) || isAdmin) {
    return next();
  }

  try {
    const cartAggregate = await prisma.cartItem.aggregate({
      where: { userId },
      _sum: { quantity: true },
    });

    res.locals.cartCount = Number(cartAggregate._sum.quantity || 0);
  } catch (error) {
    logger.warn("cart_count_load_failed", {
      userId,
      error: error.message,
    });
  }

  return next();
});

app.get("/", async (_req, res) => {
  const rawReviews = await prisma.review.findMany({
    where: {
      rating: { gte: 4 },
      product: { isActive: true },
    },
    include: {
      user: { select: { name: true, email: true } },
      product: { select: { name: true } },
    },
    orderBy: { id: "desc" },
    take: 12,
  });

  const testimonials = rawReviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    comment:
      (review.comment || "").trim() ||
      `Loved the ${review.product?.name || "Club Zero"} flavor.`,
    reviewer: review.user?.name || review.user?.email || "Club Zero Customer",
    productName: review.product?.name || null,
  }));

  const averageRating =
    testimonials.length > 0
      ? testimonials.reduce((sum, review) => sum + review.rating, 0) /
        testimonials.length
      : null;

  return res.render("home", {
    testimonials,
    averageRating,
  });
});
app.get("/about", (_req, res) => res.render("about"));
app.get("/contact", contactController.getContact);
app.post(
  "/contact",
  contactRateLimit,
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
app.get(
  "/admin/invoices",
  requireAdmin,
  asyncHandler(orderController.getAdminInvoicesPage),
);
app.get(
  "/admin/payments",
  requireAdmin,
  asyncHandler(orderController.getAdminPaymentsPage),
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
app.use("/auth/login", authRateLimit);
app.use("/auth/signup", authRateLimit);
app.use("/auth/forgot-password", authRateLimit);
app.use("/auth/reset-password", authRateLimit);
app.use("/auth/checkout", checkoutRateLimit);
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
  logger.error("request_failed", {
    requestId: res.locals.requestId || null,
    error: error.message,
    stack: error.stack,
  });
  void notifyCritical("clubzero_request_failed", {
    requestId: res.locals.requestId || null,
    error: error.message,
  });
  return res.status(500).send("Something went wrong. Please try again.");
});

process.on("unhandledRejection", (error) => {
  logger.error("unhandled_rejection", {
    error: error instanceof Error ? error.message : String(error),
  });
  void notifyCritical("clubzero_unhandled_rejection", {
    error: error instanceof Error ? error.message : String(error),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("uncaught_exception", {
    error: error.message,
    stack: error.stack,
  });
  void notifyCritical("clubzero_uncaught_exception", {
    error: error.message,
  });
});

sessionStore.ready
  .then(() => {
    app.listen(config.port, () => {
      logger.info("server_started", {
        port: config.port,
        nodeEnv: config.nodeEnv,
      });
    });
  })
  .catch((error) => {
    logger.error("session_store_boot_failed", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
