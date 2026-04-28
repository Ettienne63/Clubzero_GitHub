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
const { requireAdmin, requireOwner } = require("./middleware/adminMiddleware");
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
  stockistValidationRules,
  storeLocationValidationRules,
  storeLocationIdParamValidationRules,
  validateRedirectToAdmin,
  validateRedirectToAdminLocations,
  validateRedirectToContact,
  validateRedirectToStoreLocator,
} = require("./middleware/validation");
const productController = require("./controllers/productController");
const orderController = require("./controllers/orderController");
const contactController = require("./controllers/contactController");
const adminController = require("./controllers/adminController");
const inventoryController = require("./controllers/inventoryController");
const storeLocationController = require("./controllers/storeLocationController");
const homeController = require("./controllers/homeController");
const aboutController = require("./controllers/aboutController");
const competitionController = require("./controllers/competitionController");
const themeController = require("./controllers/themeController");
const { getPromoSettings } = require("./lib/promoSettings");
const { getHomeHeroSettings } = require("./lib/homeHeroSettings");
const { getHomeTextSettings } = require("./lib/homeTextSettings");
const { getSiteTheme } = require("./lib/themeSettings");
const { getCompetitionEntryRules } = require("./lib/competitionEntryRules");
const { getCompetitionContentSettings } = require("./lib/competitionContentSettings");
const { startCompetitionWinnerDrawScheduler } = require("./lib/competitionWinnerDraw");
const { startAbandonedCartScheduler } = require("./lib/abandonedCart");
const {
  startDailyOutOfStockSummaryScheduler,
} = require("./lib/outOfStockSummary");
const { prisma } = require("./prisma/lib/prisma");
const APPROVED_AFFILIATE_STATUS = "APPROVED";
const COMPETITION_BANNER_TIME_ZONE = "Africa/Johannesburg";

const formatCompetitionBannerDateTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const formatted = new Intl.DateTimeFormat("en-ZA", {
    timeZone: COMPETITION_BANNER_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${formatted} SAST`;
};

const resolveCompetitionBanner = (content = {}) => {
  const title = String(content.currentTitle || "").trim();
  const endsAtIso = String(content.endsAtIso || "").trim();
  const startsAtIso = String(content.competitionStartsAtIso || "").trim();
  const endsAt = new Date(endsAtIso);

  if (!title || Number.isNaN(endsAt.getTime())) {
    return null;
  }

  const now = Date.now();
  const startsAt = startsAtIso ? new Date(startsAtIso) : null;
  const hasStarted = !startsAt || Number.isNaN(startsAt.getTime()) || now >= startsAt.getTime();
  const hasNotEnded = now <= endsAt.getTime();

  if (!hasStarted || !hasNotEnded) {
    return null;
  }

  return {
    title,
    endLabel: formatCompetitionBannerDateTime(endsAt),
  };
};

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

const RETAIL_PROFIT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/plain",
]);

const uploadRetailProfitDocument = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const extension = path
      .extname(String(file.originalname || ""))
      .toLowerCase();
    const allowedExtension = [".pdf", ".xlsx", ".xls", ".csv"].includes(
      extension,
    );
    const allowedMime = RETAIL_PROFIT_ALLOWED_MIME_TYPES.has(
      String(file.mimetype || "").toLowerCase(),
    );

    if (allowedExtension || allowedMime) {
      return cb(null, true);
    }
    return cb(
      new Error("Only PDF, XLSX, XLS, and CSV files are allowed for retail profit uploads."),
    );
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
app.get("/webhooks/paystack", (req, res) => {
  const query = new URLSearchParams(req.query || {}).toString();
  const target = query
    ? `/auth/checkout/paystack?${query}`
    : "/auth/checkout/paystack";
  return res.redirect(target);
});
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
      secure: config.isProduction ? "auto" : false,
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
  res.locals.currentPath = req.path;
  res.locals.user = req.session.user || null;
  res.locals.cartCount = 0;
  res.locals.showCompetitionsNavItem = true;
  res.locals.currentCompetitionBanner = null;
  const [siteThemeResult, homeHeroResult] = await Promise.allSettled([
    getSiteTheme(),
    getHomeHeroSettings(),
  ]);
  res.locals.siteTheme =
    siteThemeResult.status === "fulfilled" ? siteThemeResult.value : "sunset";
  res.locals.navbarLogoUrl =
    homeHeroResult.status === "fulfilled"
      ? String(homeHeroResult.value?.logoUrl || "").trim()
      : "";
  const [competitionRulesResult, competitionContentResult] =
    await Promise.allSettled([
      getCompetitionEntryRules(),
      getCompetitionContentSettings(),
    ]);
  if (competitionRulesResult.status === "fulfilled") {
    res.locals.showCompetitionsNavItem = !Boolean(
      competitionRulesResult.value?.hideCompetitionsPage,
    );
  } else {
    logger.warn("competition_nav_visibility_load_failed", {
      error: competitionRulesResult.reason?.message || "Unknown error",
    });
  }
  if (
    req.path === "/" &&
    competitionContentResult.status === "fulfilled"
  ) {
    const competitionBanner = resolveCompetitionBanner(
      competitionContentResult.value,
    );
    res.locals.currentCompetitionBanner = competitionBanner;
  } else if (competitionContentResult.status === "rejected") {
    logger.warn("competition_banner_load_failed", {
      error: competitionContentResult.reason?.message || "Unknown error",
    });
  }

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
  if (!Number.isInteger(userId)) {
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
  const [rawReviews, promoSettings, homeHero, homeText, competitionContent] = await Promise.all([
    prisma.review.findMany({
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
    }),
    getPromoSettings(),
    getHomeHeroSettings(),
    getHomeTextSettings(),
    getCompetitionContentSettings(),
  ]);

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
    promoSettings,
    homeHero,
    homeText,
    competitionBanner: resolveCompetitionBanner(competitionContent),
  });
});
app.get("/about", asyncHandler(aboutController.getAboutPage));
app.get("/competitions", asyncHandler(competitionController.getCompetitionsPage));
app.get("/contact", contactController.getContact);
app.get("/store-locator", asyncHandler(async (req, res) => {
  const query = (req.query.city || "").toString().trim();

  const where = query
    ? {
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { city: { contains: query, mode: "insensitive" } },
          { state: { contains: query, mode: "insensitive" } },
          { addressLine1: { contains: query, mode: "insensitive" } },
          { addressLine2: { contains: query, mode: "insensitive" } },
        ],
      }
    : {};

  const filteredLocations = await prisma.storeLocation.findMany({
    where,
    orderBy: [{ city: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      hours: true,
      phone: true,
      mapUrl: true,
    },
  });

  return res.render("store-locator", {
    storeLocations: filteredLocations,
    searchQuery: query,
    hasSearch: Boolean(query),
    success: req.query.success || null,
    error: req.query.error || null,
  });
}));
app.post(
  "/contact",
  contactRateLimit,
  contactValidationRules,
  validateRedirectToContact,
  asyncHandler(contactController.postContact),
);
app.post(
  "/store-locator/stockist",
  contactRateLimit,
  stockistValidationRules,
  validateRedirectToStoreLocator,
  asyncHandler(contactController.postStockist),
);
app.get("/admin", requireAdmin, asyncHandler(productController.getAdminPage));
app.get(
  "/admin/promo",
  requireAdmin,
  asyncHandler(productController.getAdminPromoPage),
);
app.get(
  "/admin/promo-content",
  requireAdmin,
  asyncHandler(productController.getAdminPromoContentPage),
);
app.get(
  "/admin/delivery-pricing",
  requireAdmin,
  asyncHandler(orderController.getAdminDeliveryPricingPage),
);
app.get(
  "/admin/competition-rules",
  requireAdmin,
  asyncHandler(competitionController.getAdminCompetitionRulesPage),
);
app.post(
  "/admin/delivery-pricing",
  requireAdmin,
  asyncHandler(orderController.updateAdminDeliveryPricing),
);
app.post(
  "/admin/competition-rules",
  requireAdmin,
  asyncHandler(competitionController.updateAdminCompetitionRules),
);
app.post(
  "/admin/competition-rules/start-new",
  requireAdmin,
  asyncHandler(competitionController.startAdminCompetitionWindow),
);
app.post(
  "/admin/competition-rules/current-end",
  requireAdmin,
  asyncHandler(competitionController.updateAdminCompetitionCurrentEnd),
);
app.post(
  "/admin/competition-rules/reveal-date",
  requireAdmin,
  asyncHandler(competitionController.updateAdminCompetitionRevealDate),
);
app.post(
  "/admin/competition-rules/end-now",
  requireAdmin,
  asyncHandler(competitionController.endAdminCompetitionNow),
);
app.post(
  "/admin/competition-rules/current-end-now-test",
  requireAdmin,
  asyncHandler(competitionController.setAdminCompetitionEndNowForTest),
);
app.post(
  "/admin/competition-rules/toggle-coming-soon",
  requireAdmin,
  asyncHandler(competitionController.toggleAdminCompetitionComingSoon),
);
app.post(
  "/admin/competition-rules/toggle-page-visibility",
  requireAdmin,
  asyncHandler(competitionController.toggleAdminCompetitionPageVisibility),
);
app.post(
  "/admin/competition-rules/reset-points-window",
  requireAdmin,
  asyncHandler(competitionController.resetAdminCompetitionPointsWindow),
);
app.post(
  "/admin/competition-rules/draw-winner",
  requireAdmin,
  asyncHandler(competitionController.drawAdminCompetitionWinner),
);
app.post(
  "/admin/delivery-pricing/toggle",
  requireAdmin,
  asyncHandler(orderController.toggleAdminDeliveryPricing),
);
app.get(
  "/admin/affiliate",
  requireAdmin,
  asyncHandler(orderController.getAdminAffiliatePage),
);
app.post(
  "/admin/affiliate/rate",
  requireAdmin,
  asyncHandler(orderController.updateAffiliateRate),
);
app.get(
  "/admin/affiliate/stats",
  requireAdmin,
  asyncHandler(orderController.getAdminAffiliateStatsPage),
);
app.get(
  "/admin/analytics",
  requireAdmin,
  asyncHandler(orderController.getAdminAnalyticsPage),
);
app.get(
  "/admin/invoices",
  requireAdmin,
  asyncHandler(orderController.redirectAdminInvoicesToPayments),
);
app.get(
  "/admin/payments",
  requireAdmin,
  asyncHandler(orderController.getAdminPaymentsPage),
);
app.post(
  "/admin/payments/:id/mark-paid",
  requireAdmin,
  asyncHandler(orderController.markAdminOrderPaid),
);
app.post(
  "/admin/payments/retail-profit/upload",
  requireAdmin,
  uploadRetailProfitDocument.single("retailProfitFile"),
  asyncHandler(orderController.uploadAdminRetailProfitFile),
);
app.post(
  "/admin/payments/retail-profit/:id/delete",
  requireAdmin,
  asyncHandler(orderController.deleteAdminRetailProfitFile),
);
app.get(
  "/admin/payments/retail-profit/export",
  requireAdmin,
  asyncHandler(orderController.downloadAdminRetailProfitHistory),
);
app.get(
  "/admin/payments/retail-profit/export-bundle",
  requireAdmin,
  asyncHandler(orderController.downloadAdminRetailProfitBundle),
);
app.get(
  "/admin/team",
  requireOwner,
  asyncHandler(adminController.getAdminTeamPage),
);
app.get(
  "/admin/stockists",
  requireAdmin,
  asyncHandler(adminController.getAdminStockistsPage),
);
app.get(
  "/admin/inventory",
  requireAdmin,
  asyncHandler(inventoryController.getAdminInventoryPage),
);
app.get(
  "/admin/theme",
  requireAdmin,
  asyncHandler(themeController.getAdminThemePage),
);
app.post(
  "/admin/theme",
  requireAdmin,
  asyncHandler(themeController.updateAdminTheme),
);
app.get(
  "/admin/inventory/history/export",
  requireAdmin,
  asyncHandler(inventoryController.exportInventoryHistory),
);
app.get(
  "/admin/home-content",
  requireAdmin,
  asyncHandler(homeController.getAdminHomeContent),
);
app.get(
  "/admin/nav-edit",
  requireAdmin,
  asyncHandler(homeController.getAdminNavEdit),
);
app.get(
  "/admin/about-content",
  requireAdmin,
  asyncHandler(aboutController.getAdminAboutContent),
);
app.get(
  "/admin/competitions-content",
  requireAdmin,
  asyncHandler(competitionController.getAdminCompetitionContent),
);
app.post(
  "/admin/home-content",
  requireAdmin,
  upload.single("heroImage"),
  asyncHandler(homeController.updateAdminHomeContent),
);
app.post(
  "/admin/nav-edit",
  requireAdmin,
  upload.single("heroLogo"),
  asyncHandler(homeController.updateAdminNavEdit),
);
app.post(
  "/admin/about-content",
  requireAdmin,
  upload.fields([
    { name: "aboutIntroImage", maxCount: 1 },
    { name: "teamMember1Image", maxCount: 1 },
    { name: "teamMember2Image", maxCount: 1 },
    { name: "teamMember3Image", maxCount: 1 },
    { name: "teamMember4Image", maxCount: 1 },
  ]),
  asyncHandler(aboutController.updateAdminAboutContent),
);
app.post(
  "/admin/competitions-content",
  requireAdmin,
  upload.single("heroImage"),
  asyncHandler(competitionController.updateAdminCompetitionContent),
);
app.get(
  "/admin/locations",
  requireAdmin,
  asyncHandler(storeLocationController.getAdminLocationsPage),
);
app.post(
  "/admin/locations",
  requireAdmin,
  storeLocationValidationRules,
  validateRedirectToAdminLocations,
  asyncHandler(storeLocationController.createLocation),
);
app.post(
  "/admin/locations/:id/edit",
  requireAdmin,
  storeLocationIdParamValidationRules,
  storeLocationValidationRules,
  validateRedirectToAdminLocations,
  asyncHandler(storeLocationController.updateLocation),
);
app.post(
  "/admin/locations/:id/delete",
  requireAdmin,
  storeLocationIdParamValidationRules,
  validateRedirectToAdminLocations,
  asyncHandler(storeLocationController.deleteLocation),
);
app.post(
  "/admin/team/invite",
  requireOwner,
  asyncHandler(adminController.postAdminInvite),
);
app.post(
  "/admin/team/invite/:id/resend",
  requireOwner,
  asyncHandler(adminController.resendAdminInvite),
);
app.post(
  "/admin/team/invite/:id/revoke",
  requireOwner,
  asyncHandler(adminController.revokeAdminInvite),
);
app.post(
  "/admin/team/user/:id/role",
  requireOwner,
  asyncHandler(adminController.updateUserRole),
);
app.post(
  "/admin/team/user/:id/revoke",
  requireOwner,
  asyncHandler(adminController.revokeUserAccess),
);
app.post(
  "/admin/stockists/:id/status",
  requireAdmin,
  asyncHandler(adminController.updateStockistStatus),
);
app.post(
  "/admin/inventory/suppliers",
  requireAdmin,
  asyncHandler(inventoryController.createSupplier),
);
app.post(
  "/admin/inventory/suppliers/:id/edit",
  requireAdmin,
  asyncHandler(inventoryController.updateSupplier),
);
app.post(
  "/admin/inventory/suppliers/:id/delete",
  requireAdmin,
  asyncHandler(inventoryController.deleteSupplier),
);
app.post(
  "/admin/inventory/suppliers/:id/restore",
  requireAdmin,
  asyncHandler(inventoryController.restoreSupplier),
);
app.post(
  "/admin/inventory/suppliers/:id/custom-products",
  requireAdmin,
  asyncHandler(inventoryController.createSupplierCustomProduct),
);
app.post(
  "/admin/inventory/suppliers/:id/custom-products/import-website",
  requireAdmin,
  asyncHandler(inventoryController.importSupplierCustomProductsFromWebsite),
);
app.post(
  "/admin/inventory/suppliers/:id/custom-products/:customProductId/edit",
  requireAdmin,
  asyncHandler(inventoryController.updateSupplierCustomProduct),
);
app.post(
  "/admin/inventory/suppliers/:id/custom-products/:customProductId/threshold",
  requireAdmin,
  asyncHandler(inventoryController.updateSupplierCustomLowStockThreshold),
);
app.post(
  "/admin/inventory/suppliers/:id/custom-products/:customProductId/delete",
  requireAdmin,
  asyncHandler(inventoryController.deleteSupplierCustomProduct),
);
app.post(
  "/admin/inventory/website-stock/:id",
  requireAdmin,
  asyncHandler(inventoryController.updateWebsiteStock),
);
app.post(
  "/admin/inventory/products/:id/threshold",
  requireAdmin,
  asyncHandler(inventoryController.updateWebsiteLowStockThreshold),
);
app.post(
  "/admin/inventory/alerts-toggle",
  requireAdmin,
  asyncHandler(inventoryController.updateLowStockAlertsSetting),
);
app.post(
  "/admin/inventory/products/:id/stock-visibility",
  requireAdmin,
  asyncHandler(inventoryController.updateProductStockVisibility),
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
  "/admin/promo",
  requireAdmin,
  upload.single("promoImage"),
  asyncHandler(productController.updatePromoSettings),
);
app.post(
  "/admin/promo/toggle",
  requireAdmin,
  asyncHandler(productController.updatePromoEnabled),
);
app.post(
  "/admin/promo/countdown",
  requireAdmin,
  asyncHandler(productController.updatePromoCountdown),
);
app.post(
  "/admin/promo/discounts",
  requireAdmin,
  asyncHandler(productController.updateProductDiscounts),
);
app.post(
  "/admin/mix-lab/pricing",
  requireAdmin,
  asyncHandler(productController.updateMixLabPricing),
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

app.use((error, req, res, _next) => {
  logger.error("request_failed", {
    requestId: res.locals.requestId || null,
    error: error.message,
    stack: error.stack,
  });
  void notifyCritical("clubzero_request_failed", {
    requestId: res.locals.requestId || null,
    error: error.message,
  });

  const contentRouteErrorMap = {
    "/admin/home-content":
      "We couldn't process Home content right now. Please try again.",
    "/admin/about-content":
      "We couldn't process About content right now. Please try again.",
    "/admin/competitions-content":
      "We couldn't process Competition content right now. Please try again.",
    "/admin/competition-rules":
      "We couldn't process Competition rules right now. Please try again.",
    "/admin/nav-edit":
      "We couldn't process Nav content right now. Please try again.",
  };
  const mappedMessage = contentRouteErrorMap[req.path];

  if (mappedMessage) {
    if (req.method.toUpperCase() === "POST") {
      return res.redirect(
        `${req.path}?error=${encodeURIComponent(
          `${mappedMessage} Your form inputs were kept.`,
        )}`,
      );
    }

    return res.status(500).send(mappedMessage);
  }

  return res
    .status(500)
    .send("We hit an unexpected error on this page. Please refresh and try again.");
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
    startAbandonedCartScheduler();
    startDailyOutOfStockSummaryScheduler();
    startCompetitionWinnerDrawScheduler();
  })
  .catch((error) => {
    logger.error("session_store_boot_failed", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
