const { prisma } = require("../prisma/lib/prisma");
const {
  buildPurchasedProductIdSet,
  getPurchasedProductIdsForUser,
} = require("../lib/reviewEligibility");
const {
  getPromoSettings,
  savePromoSettings,
  setPromoDiscountsEnabled,
  setMixLabCasePrice,
  setMixLabDiscountSettings,
} = require("../lib/promoSettings");
const { clampDiscountPercent } = require("../lib/pricing");

const PROMO_LIMITS = {
  badge: 40,
  title: 120,
  subtitle: 180,
  body: 400,
  ctaLabel: 40,
  ctaUrl: 220,
  secondaryLabel: 40,
  secondaryUrl: 220,
  imageUrl: 300,
  finePrint: 140,
  countdownPrefix: 32,
};

const toOptionalText = (value) => {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
};

const productWithReviewRatingsInclude = {
  reviews: {
    select: {
      rating: true,
    },
  },
};

const productWithReviewDetailsInclude = {
  reviews: {
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { id: "desc" },
  },
};

const mapProductWithReviewStats = (product) => {
  const ratings = product.reviews.map((review) => review.rating);
  const averageRating = ratings.length
    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    : null;

  return {
    ...product,
    averageRating,
    reviewCount: product.reviews.length,
  };
};

const getRecentlyViewedProductIds = (req) => {
  const ids = Array.isArray(req.session?.recentlyViewedProductIds)
    ? req.session.recentlyViewedProductIds
    : [];

  return ids
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
};

const setRecentlyViewedProductIds = (req, ids) => {
  if (!req.session) {
    return;
  }

  req.session.recentlyViewedProductIds = ids.slice(0, 5);
};

const normalizeMixLabPrice = (value) => {
  const trimmed = (value || "").toString().trim();
  if (!trimmed) {
    return "";
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed.toFixed(2);
};

const getMixLabViewState = (promoSettings = {}) => {
  const normalizedPrice = normalizeMixLabPrice(promoSettings?.mixLabCasePrice);
  const hasFixedPrice = normalizedPrice !== "" && normalizedPrice !== null;
  const baseCasePrice = hasFixedPrice ? Number(normalizedPrice) : 0;
  const mixLabDiscountPercent = clampDiscountPercent(
    Number(promoSettings?.mixLabDiscountPercent || 0),
  );
  const mixLabDiscountEnabled = promoSettings?.mixLabDiscountEnabled !== false;
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );
  const discountActive = discountsEnabled && mixLabDiscountEnabled;
  const discountedCasePrice =
    hasFixedPrice && discountActive && mixLabDiscountPercent > 0
      ? baseCasePrice * (1 - mixLabDiscountPercent / 100)
      : baseCasePrice;

  return {
    hasFixedPrice,
    baseCasePrice,
    baseCasePriceInput: hasFixedPrice ? normalizedPrice : "",
    discountPercent: mixLabDiscountPercent,
    discountEnabled: mixLabDiscountEnabled,
    discountActive,
    discountedCasePrice,
  };
};

const parseProductInput = (body, file, options = {}) => {
  const {
    currentImageUrl = "",
    currentWebsiteStock = null,
    requireImage = true,
  } = options;
  const name = (body.name || "").trim();
  const imageUrlFromInput = (body.imageUrl || "").trim();
  const description = (body.description || "").trim();
  const nutritionInfo = toOptionalText(body.nutritionInfo);
  const ingredients = toOptionalText(body.ingredients);
  const bestFor = toOptionalText(body.bestFor);
  const storageInfo = toOptionalText(body.storageInfo);
  const price = Number.parseFloat(body.price);
  const websiteStockRaw = (body.websiteStock || "").toString().trim();
  const hasWebsiteStockInput = websiteStockRaw !== "";
  const websiteStock = hasWebsiteStockInput
    ? Number.parseInt(websiteStockRaw, 10)
    : null;
  const discountPercentRaw = (body.discountPercent || "").toString().trim();
  const parsedDiscount = Number.parseFloat(discountPercentRaw);
  const discountPercent = discountPercentRaw
    ? clampDiscountPercent(parsedDiscount)
    : 0;
  const imageUrl = file
    ? `/uploads/${file.filename}`
    : imageUrlFromInput || currentImageUrl;

  if (!name || !description || (requireImage && !imageUrl)) {
    return { error: "Name, image, and description are required." };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a valid non-negative number." };
  }

  if (hasWebsiteStockInput && (!Number.isInteger(websiteStock) || websiteStock < 0)) {
    return { error: "Website stock must be a whole number 0 or greater." };
  }

  if (discountPercentRaw && !Number.isFinite(parsedDiscount)) {
    return { error: "Discount must be a valid percentage." };
  }

  if (Number.isFinite(parsedDiscount) && (parsedDiscount < 0 || parsedDiscount > 90)) {
    return { error: "Discount must be between 0% and 90%." };
  }

  const data = {
    name,
    imageUrl,
    description,
    price,
      discountPercent,
      nutritionInfo,
    ingredients,
    bestFor,
    storageInfo,
  };

  if (hasWebsiteStockInput) {
    data.websiteStock = websiteStock;
  } else if (!Number.isInteger(currentWebsiteStock)) {
    data.websiteStock = 0;
  }

  return { data };
};

const normalizePromoUrl = (value, label) => {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return { value: "" };
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:")) {
    return { error: `${label} cannot start with javascript:` };
  }
  if (!trimmed.startsWith("/") && !/^https?:\/\//i.test(trimmed)) {
    return { error: `${label} must start with http(s):// or /` };
  }
  return { value: trimmed };
};

const enforceMaxLength = (value, max, label) => {
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer.`;
  }
  return null;
};

const parsePromoInput = (body, file, current = {}) => {
  const enabled = body.promoEnabled === "on";
  const badge = (body.promoBadge || "").trim();
  const title = (body.promoTitle || "").trim();
  const subtitle = (body.promoSubtitle || "").trim();
  const bodyText = (body.promoBody || "").trim();
  const ctaLabel = (body.promoCtaLabel || "").trim();
  const ctaUrlRaw = (body.promoCtaUrl || "").trim();
  const secondaryLabel = (body.promoSecondaryLabel || "").trim();
  const secondaryUrlRaw = (body.promoSecondaryUrl || "").trim();
  const finePrint = (body.promoFinePrint || "").trim();
  const countdownEnabled = body.promoCountdownEnabled === "on";
  const countdownPrefix = (body.promoCountdownPrefix || "").trim();
  const countdownEndDateRaw = (body.promoCountdownEndDate || "").trim();
  const imageUrlInput = (body.promoImageUrl || "").trim();
  const removeImage = body.promoImageRemove === "on";
  const imageUrl = file
    ? `/uploads/${file.filename}`
    : removeImage
      ? ""
      : imageUrlInput || current.imageUrl || "";

  const urlValidation = normalizePromoUrl(ctaUrlRaw, "Primary CTA URL");
  if (urlValidation.error) {
    return { error: urlValidation.error };
  }
  const secondaryUrlValidation = normalizePromoUrl(
    secondaryUrlRaw,
    "Secondary CTA URL",
  );
  if (secondaryUrlValidation.error) {
    return { error: secondaryUrlValidation.error };
  }

  const lengthChecks = [
    enforceMaxLength(badge, PROMO_LIMITS.badge, "Badge"),
    enforceMaxLength(title, PROMO_LIMITS.title, "Title"),
    enforceMaxLength(subtitle, PROMO_LIMITS.subtitle, "Subtitle"),
    enforceMaxLength(bodyText, PROMO_LIMITS.body, "Body text"),
    enforceMaxLength(ctaLabel, PROMO_LIMITS.ctaLabel, "Primary CTA label"),
    enforceMaxLength(ctaUrlRaw, PROMO_LIMITS.ctaUrl, "Primary CTA URL"),
    enforceMaxLength(
      secondaryLabel,
      PROMO_LIMITS.secondaryLabel,
      "Secondary CTA label",
    ),
    enforceMaxLength(
      secondaryUrlRaw,
      PROMO_LIMITS.secondaryUrl,
      "Secondary CTA URL",
    ),
    enforceMaxLength(imageUrl, PROMO_LIMITS.imageUrl, "Image URL"),
    enforceMaxLength(finePrint, PROMO_LIMITS.finePrint, "Fine print"),
    enforceMaxLength(
      countdownPrefix,
      PROMO_LIMITS.countdownPrefix,
      "Countdown prefix",
    ),
  ];

  const lengthError = lengthChecks.find(Boolean);
  if (lengthError) {
    return { error: lengthError };
  }

  if (enabled) {
    if (!title) {
      return { error: "Title is required when the promotion is enabled." };
    }
    if (!bodyText) {
      return { error: "Body text is required when the promotion is enabled." };
    }
    if (!ctaLabel || !urlValidation.value) {
      return {
        error: "Primary CTA label and URL are required when enabled.",
      };
    }
  }

  if ((ctaLabel && !urlValidation.value) || (!ctaLabel && urlValidation.value)) {
    return { error: "Primary CTA label and URL must be provided together." };
  }

  if (
    (secondaryLabel && !secondaryUrlValidation.value) ||
    (!secondaryLabel && secondaryUrlValidation.value)
  ) {
    return {
      error: "Secondary CTA label and URL must be provided together.",
    };
  }

  const countdownEndDate = countdownEndDateRaw;
  if (countdownEndDate) {
    const parsedDate = new Date(`${countdownEndDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: "Countdown end date must be a valid date." };
    }
  }

  return {
    data: {
      enabled,
      badge,
      title,
      subtitle,
      body: bodyText,
      ctaLabel,
      ctaUrl: urlValidation.value,
      secondaryLabel,
      secondaryUrl: secondaryUrlValidation.value,
      imageUrl,
      finePrint,
      countdownEnabled,
      countdownPrefix,
      countdownEndDate,
    },
  };
};

const getProducts = (search = "", options = {}) => {
  const { includeInactive = false, includeReviewRatings = false } = options;
  const trimmedSearch = search.trim();
  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(trimmedSearch
      ? {
          OR: [
            { name: { contains: trimmedSearch, mode: "insensitive" } },
            { description: { contains: trimmedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  return prisma.product.findMany({
    where,
    ...(includeReviewRatings ? { include: productWithReviewRatingsInclude } : {}),
    orderBy: { id: "desc" },
  });
};

exports.listProducts = async (req, res) => {
  const searchQuery = (req.query.search || "").toString();
  const userId = Number.parseInt(req.session?.user?.id, 10);
  const [products, recentlyViewedProductsRaw, promoSettings] = await Promise.all([
    getProducts(searchQuery, { includeReviewRatings: true }),
    prisma.product.findMany({
      where: { id: { in: getRecentlyViewedProductIds(req) }, isActive: true },
      include: productWithReviewRatingsInclude,
    }),
    getPromoSettings(),
  ]);
  let purchasedProductIds = [];
  let myReviewsByProduct = {};

  const recentlyViewedProductsById = recentlyViewedProductsRaw.reduce(
    (acc, product) => {
      acc[product.id] = mapProductWithReviewStats(product);
      return acc;
    },
    {},
  );
  const recentlyViewedProducts = getRecentlyViewedProductIds(req)
    .map((id) => recentlyViewedProductsById[id])
    .filter(Boolean);

  if (Number.isInteger(userId)) {
    const [purchasedProductIdSet, myReviews] = await Promise.all([
      getPurchasedProductIdsForUser(prisma, userId),
      prisma.review.findMany({
        where: { userId },
        select: { productId: true, rating: true, comment: true },
      }),
    ]);

    purchasedProductIds = Array.from(purchasedProductIdSet);
    myReviewsByProduct = myReviews.reduce((acc, review) => {
      acc[review.productId] = {
        rating: review.rating,
        comment: review.comment || "",
      };
      return acc;
    }, {});
  }

  const productsWithStats = products.map(mapProductWithReviewStats);
  const mixLabSettings = getMixLabViewState(promoSettings);

  res.render("products", {
    products: productsWithStats,
    recentlyViewedProducts,
    searchQuery,
    success: req.query.success || null,
    error: req.query.error || null,
    purchasedProductIds,
    myReviewsByProduct,
    discountsEnabled: Boolean(
      promoSettings?.enabled && promoSettings?.discountsEnabled,
    ),
    mixLabSettings,
  });
};

exports.getProductDetails = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const isAdmin = ["ADMIN", "OWNER"].includes(
    String(req.session?.user?.role || "").toUpperCase(),
  );

  const [product, promoSettings] = await Promise.all([
    prisma.product.findFirst({
      where: {
        id: productId,
        ...(isAdmin ? {} : { isActive: true }),
      },
      include: productWithReviewDetailsInclude,
    }),
    getPromoSettings(),
  ]);

  if (!product) {
    return res.status(404).send("Product not found");
  }

  const existingIds = getRecentlyViewedProductIds(req).filter(
    (id) => id !== productId,
  );
  setRecentlyViewedProductIds(req, [productId, ...existingIds]);

  return res.render("product-details", {
    product: mapProductWithReviewStats(product),
    success: req.query.success || null,
    error: req.query.error || null,
    discountsEnabled: Boolean(
      promoSettings?.enabled && promoSettings?.discountsEnabled,
    ),
  });
};

exports.createReview = async (req, res) => {
  const userId = Number.parseInt(req.session?.user?.id, 10);
  const productId = Number.parseInt(req.params.id, 10);
  const rating = Number.parseInt(req.body.rating, 10);
  const comment = (req.body.comment || "").trim();

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });

  if (!product) {
    return res.redirect(
      `/auth/products?error=${encodeURIComponent(
        "This product is no longer available.",
      )}`,
    );
  }

  const purchasedProductIds = await getPurchasedProductIdsForUser(prisma, userId);
  const purchased = purchasedProductIds.has(productId);

  if (!purchased) {
    return res.redirect(
      `/auth/products?error=${encodeURIComponent("You can only review products you have purchased.")}`,
    );
  }

  await prisma.review.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    create: {
      userId,
      productId,
      rating,
      comment: comment || null,
    },
    update: {
      rating,
      comment: comment || null,
    },
  });

  return res.redirect(
    `/auth/products?success=${encodeURIComponent("Your review has been saved.")}`,
  );
};

exports.getAdminPage = async (req, res) => {
  const [products, promoSettings] = await Promise.all([
    getProducts("", { includeInactive: true }),
    getPromoSettings(),
  ]);

  res.render("admin", {
    products,
    mixLabSettings: getMixLabViewState(promoSettings),
    success: req.query.success || null,
    error: req.query.error || null,
    formData: {
      name: "",
      imageUrl: "",
      description: "",
      price: "",
      nutritionInfo: "",
      ingredients: "",
      bestFor: "",
      storageInfo: "",
    },
  });
};

exports.getAdminPromoPage = async (req, res) => {
  const [promoSettings, products] = await Promise.all([
    getPromoSettings(),
    getProducts("", { includeInactive: true }),
  ]);

  return res.render("admin-promo", {
    promoSettings,
    mixLabSettings: getMixLabViewState(promoSettings),
    products,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.getAdminPromoContentPage = async (req, res) => {
  const promoSettings = await getPromoSettings();

  return res.render("admin-promo-content", {
    promoSettings,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updatePromoEnabled = async (req, res) => {
  const current = await getPromoSettings();
  const enabled = req.body?.promoEnabled === "on";

  await savePromoSettings({
    ...current,
    enabled,
    discountsEnabled: enabled ? current.discountsEnabled !== false : false,
    countdownEnabled: enabled ? current.countdownEnabled === true : false,
  });

  return res.redirect(
    `/admin/promo?success=${encodeURIComponent(
      enabled
        ? "Promotion is now visible on the homepage."
        : "Promotion has been hidden from the homepage.",
    )}`,
  );
};

exports.updatePromoCountdown = async (req, res) => {
  const current = await getPromoSettings();
  const countdownEnabled =
    current?.enabled && req.body?.promoCountdownEnabled === "on";
  const countdownPrefix = (req.body?.promoCountdownPrefix || "Ends in")
    .toString()
    .trim()
    .slice(0, PROMO_LIMITS.countdownPrefix);
  const countdownEndDate = (req.body?.promoCountdownEndDate || "")
    .toString()
    .trim();

  if (countdownEndDate) {
    const parsedDate = new Date(`${countdownEndDate}T00:00:00.000Z`);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.redirect(
        `/admin/promo?error=${encodeURIComponent(
          "Countdown end date must be a valid date.",
        )}`,
      );
    }
  }

  await savePromoSettings({
    ...current,
    countdownEnabled,
    countdownPrefix,
    countdownEndDate,
  });

  return res.redirect("/admin/promo?success=Countdown+updated");
};

exports.updateProductDiscounts = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");
  const promoSettings = await getPromoSettings();
  const payload = req.body?.discountPercent;
  let entries = [];

  if (payload && typeof payload === "object") {
    entries = Object.entries(payload);
  }

  if (!entries.length && req.body && typeof req.body === "object") {
    entries = Object.entries(req.body)
      .filter(([key]) => key.startsWith("discountPercent[") && key.endsWith("]"))
      .map(([key, value]) => {
        const idValue = key.slice("discountPercent[".length, -1);
        return [idValue, value];
      });
  }

  if (!entries.length && req.body && typeof req.body === "object") {
    entries = Object.entries(req.body)
      .filter(([key]) => key.startsWith("discountPercent_"))
      .map(([key, value]) => {
        const idValue = key.slice("discountPercent_".length);
        return [idValue, value];
      });
  }

  const discountEnabledEntries =
    req.body && typeof req.body === "object"
      ? Object.entries(req.body)
          .filter(([key]) => key.startsWith("discountEnabled_"))
          .map(([key, value]) => {
            const idValue = key.slice("discountEnabled_".length);
            return [idValue, value];
          })
      : [];
  const mixLabDiscountRaw = (req.body?.mixLabDiscountPercent || "")
    .toString()
    .trim();
  const hasMixLabDiscountPercent = mixLabDiscountRaw !== "";
  const parsedMixLabDiscount = hasMixLabDiscountPercent
    ? Number.parseFloat(mixLabDiscountRaw)
    : Number(promoSettings?.mixLabDiscountPercent || 0);
  const mixLabDiscountEnabledRaw = req.body?.mixLabDiscountEnabled;
  const hasMixLabDiscountEnabled =
    typeof mixLabDiscountEnabledRaw !== "undefined";
  const mixLabDiscountEnabled = hasMixLabDiscountEnabled
    ? Array.isArray(mixLabDiscountEnabledRaw)
      ? mixLabDiscountEnabledRaw
          .map((value) => String(value).toLowerCase())
          .includes("on")
      : String(mixLabDiscountEnabledRaw || "").toLowerCase() === "on"
    : promoSettings?.mixLabDiscountEnabled !== false;

  const updates = [];
  const hasGlobalToggle =
    typeof req.body?.discountsEnabled !== "undefined" ||
    typeof req.body?.discountsEnabled === "string";
  const requestedDiscountsEnabled =
    String(req.body?.discountsEnabled || "").toLowerCase() === "on";
  const perProductEnabledAny = discountEnabledEntries.some(([_, value]) => {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).toLowerCase()).includes("on");
    }
    return String(value || "").toLowerCase() === "on";
  });
  const discountsEnabled = promoSettings?.enabled
    ? hasGlobalToggle
      ? requestedDiscountsEnabled || perProductEnabledAny
      : perProductEnabledAny || Boolean(promoSettings?.discountsEnabled)
    : false;

  if (hasMixLabDiscountPercent && !Number.isFinite(parsedMixLabDiscount)) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: "Mix Lab discount must be a number.",
      });
    }
    return res.redirect(
      `/admin/promo?error=${encodeURIComponent(
        "Mix Lab discount must be a number.",
      )}`,
    );
  }

  if (
    Number.isFinite(parsedMixLabDiscount) &&
    (parsedMixLabDiscount < 0 || parsedMixLabDiscount > 90)
  ) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: "Mix Lab discount must be between 0% and 90%.",
      });
    }
    return res.redirect(
      `/admin/promo?error=${encodeURIComponent(
        "Mix Lab discount must be between 0% and 90%.",
      )}`,
    );
  }

  if (!entries.length && !discountEnabledEntries.length) {
    await setPromoDiscountsEnabled(discountsEnabled);
    await setMixLabDiscountSettings({
      mixLabDiscountPercent: clampDiscountPercent(parsedMixLabDiscount),
      mixLabDiscountEnabled,
    });

    if (wantsJson) {
      return res.json({ success: true, message: "Discounts updated." });
    }
    return res.redirect("/admin/promo?success=Discounts+updated");
  }

  const percentMap = new Map(entries);
  const enabledMap = new Map(discountEnabledEntries);
  const productIds = new Set([
    ...Array.from(percentMap.keys()),
    ...Array.from(enabledMap.keys()),
  ]);

  for (const idValue of productIds) {
    const productId = Number.parseInt(idValue, 10);
    if (!Number.isInteger(productId)) {
      continue;
    }

    const raw = percentMap.has(idValue)
      ? (percentMap.get(idValue) ?? "").toString().trim()
      : null;
    const parsed = raw !== null && raw !== "" ? Number.parseFloat(raw) : null;

    if (raw && !Number.isFinite(parsed)) {
      if (wantsJson) {
        return res.status(400).json({
          success: false,
          message: "Discount must be a number.",
        });
      }
      return res.redirect(
        `/admin/promo?error=${encodeURIComponent("Discount must be a number.")}`,
      );
    }

    if (Number.isFinite(parsed) && (parsed < 0 || parsed > 90)) {
      if (wantsJson) {
        return res.status(400).json({
          success: false,
          message: "Discount must be between 0% and 90%.",
        });
      }
      return res.redirect(
        `/admin/promo?error=${encodeURIComponent(
          "Discount must be between 0% and 90%.",
        )}`,
      );
    }

    const discountEnabledRaw = enabledMap.get(idValue);
    const perProductEnabled = Array.isArray(discountEnabledRaw)
      ? discountEnabledRaw
          .map((value) => String(value).toLowerCase())
          .includes("on")
      : String(discountEnabledRaw || "").toLowerCase() === "on";
    const discountEnabled = discountsEnabled ? perProductEnabled : false;

    const data = { discountEnabled };
    if (Number.isFinite(parsed)) {
      data.discountPercent = clampDiscountPercent(parsed);
    }

    updates.push(
      prisma.product.updateMany({
        where: { id: productId },
        data,
      }),
    );
  }

  if (updates.length) {
    const results = await prisma.$transaction([
      ...(!discountsEnabled
        ? [
            prisma.product.updateMany({
              data: { discountEnabled: false },
            }),
          ]
        : []),
      ...updates,
    ]);
    await setPromoDiscountsEnabled(discountsEnabled);
    await setMixLabDiscountSettings({
      mixLabDiscountPercent: clampDiscountPercent(parsedMixLabDiscount),
      mixLabDiscountEnabled,
    });
    const updateResults = results;
    const updatedCount = updateResults.reduce(
      (sum, result) => sum + Number(result?.count || 0),
      0,
    );

    if (updatedCount === 0) {
      if (wantsJson) {
        return res.status(400).json({
          success: false,
          message:
            "No matching products were updated. Please refresh the page and try again.",
        });
      }
      return res.redirect(
        `/admin/promo?error=${encodeURIComponent(
          "No matching products were updated. Please refresh the page and try again.",
        )}`,
      );
    }

    if (wantsJson) {
      return res.json({
        success: true,
        message: `Discounts updated for ${updatedCount} product(s).`,
        discountsEnabled,
      });
    }
    return res.redirect(
      `/admin/promo?success=${encodeURIComponent(
        `Discounts updated for ${updatedCount} product(s).`,
      )}`,
    );
  }

  if (wantsJson) {
    await setMixLabDiscountSettings({
      mixLabDiscountPercent: clampDiscountPercent(parsedMixLabDiscount),
      mixLabDiscountEnabled,
    });
    return res.json({
      success: true,
      message: "Discounts updated.",
      discountsEnabled,
    });
  }
  await setMixLabDiscountSettings({
    mixLabDiscountPercent: clampDiscountPercent(parsedMixLabDiscount),
    mixLabDiscountEnabled,
  });
  return res.redirect("/admin/promo?success=Discounts+updated");
};

exports.updateMixLabPricing = async (req, res) => {
  const normalized = normalizeMixLabPrice(req.body?.mixLabCasePrice);
  if (normalized === null) {
    return res.redirect(
      `/admin?error=${encodeURIComponent(
        "Mix Lab case price must be a valid non-negative number.",
      )}`,
    );
  }

  await setMixLabCasePrice(normalized);
  const message = normalized
    ? `Mix Lab case price set to R${Number(normalized).toFixed(2)}.`
    : "Mix Lab case price switched to flavour-based auto pricing.";
  return res.redirect(`/admin?success=${encodeURIComponent(message)}`);
};

exports.updatePromoSettings = async (req, res) => {
  const requestedReturnTo = (req.body?.promoReturnTo || "").toString().trim();
  const allowedReturnTo = new Set(["/admin/promo", "/admin/promo-content"]);
  const returnTo = allowedReturnTo.has(requestedReturnTo)
    ? requestedReturnTo
    : "/admin/promo-content";
  const current = await getPromoSettings();
  const parsed = parsePromoInput(req.body, req.file, current);

  if (parsed.error) {
    return res.redirect(`${returnTo}?error=${encodeURIComponent(parsed.error)}`);
  }

  const nextSettings = {
    ...current,
    ...parsed.data,
    discountsEnabled: parsed.data.enabled
      ? current.discountsEnabled !== false
      : false,
  };

  await savePromoSettings(nextSettings);
  return res.redirect(`${returnTo}?success=Promotion+updated`);
};

exports.createProduct = async (req, res) => {
  const parsed = parseProductInput(req.body, req.file);

  if (parsed.error) {
    const products = await getProducts();
    const promoSettings = await getPromoSettings();
    return res.status(400).render("admin", {
      products,
      mixLabSettings: getMixLabViewState(promoSettings),
      success: null,
      error: parsed.error,
      formData: req.body,
    });
  }

  try {
    await prisma.product.create({
      data: {
        ...parsed.data,
        showStockOnCard: false,
      },
    });
    return res.redirect("/admin?success=Product+created");
  } catch (error) {
    const products = await getProducts();
    const promoSettings = await getPromoSettings();
    const errorMessage =
      error.code === "P2002"
        ? "A product with this name already exists."
        : "Unable to create product. Please try again.";

    return res.status(400).render("admin", {
      products,
      mixLabSettings: getMixLabViewState(promoSettings),
      success: null,
      error: errorMessage,
      formData: req.body,
    });
  }
};

exports.updateProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existingProduct) {
    return res.status(404).send("Product not found");
  }

  const parsed = parseProductInput(req.body, req.file, {
    currentImageUrl: existingProduct.imageUrl,
    currentWebsiteStock: existingProduct.websiteStock,
    requireImage: true,
  });

  if (parsed.error) {
    return res.redirect(`/admin?error=${encodeURIComponent(parsed.error)}`);
  }

  try {
    await prisma.product.update({
      where: { id: productId },
      data: parsed.data,
    });

    return res.redirect("/admin?success=Product+updated");
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).send("Product not found");
    }

    const errorMessage =
      error.code === "P2002"
        ? "A product with this name already exists."
        : "Unable to update product. Please try again.";

    return res.redirect(`/admin?error=${encodeURIComponent(errorMessage)}`);
  }
};

exports.deleteProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });

  if (!existingProduct) {
    return res.redirect("/admin?error=Product+not+found");
  }

  if (!existingProduct.isActive) {
    return res.redirect("/admin?success=Product+already+hidden");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: false },
  });

  return res.redirect("/admin?success=Product+hidden");
};

exports.restoreProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });

  if (!existingProduct) {
    return res.redirect("/admin?error=Product+not+found");
  }

  if (existingProduct.isActive) {
    return res.redirect("/admin?success=Product+already+visible");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: true },
  });

  return res.redirect("/admin?success=Product+restored");
};
