const { prisma } = require("../prisma/lib/prisma");
const { getPromoSettings, savePromoSettings } = require("../lib/promoSettings");
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
};

const toOptionalText = (value) => {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
};

const productWithReviewsInclude = {
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

const parseProductInput = (body, file, options = {}) => {
  const { currentImageUrl = "", requireImage = true } = options;
  const name = (body.name || "").trim();
  const imageUrlFromInput = (body.imageUrl || "").trim();
  const description = (body.description || "").trim();
  const nutritionInfo = toOptionalText(body.nutritionInfo);
  const ingredients = toOptionalText(body.ingredients);
  const bestFor = toOptionalText(body.bestFor);
  const storageInfo = toOptionalText(body.storageInfo);
  const price = Number.parseFloat(body.price);
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

  if (discountPercentRaw && !Number.isFinite(parsedDiscount)) {
    return { error: "Discount must be a valid percentage." };
  }

  if (Number.isFinite(parsedDiscount) && (parsedDiscount < 0 || parsedDiscount > 90)) {
    return { error: "Discount must be between 0% and 90%." };
  }

  return {
    data: {
      name,
      imageUrl,
      description,
      price,
      discountPercent,
      nutritionInfo,
      ingredients,
      bestFor,
      storageInfo,
    },
  };
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
    },
  };
};

const getProducts = (search = "", options = {}) => {
  const { includeInactive = false } = options;
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
    include: productWithReviewsInclude,
    orderBy: { id: "desc" },
  });
};

exports.listProducts = async (req, res) => {
  const searchQuery = (req.query.search || "").toString();
  const userId = Number.parseInt(req.session?.user?.id, 10);
  const [products, recentlyViewedProductsRaw, promoSettings] = await Promise.all([
    getProducts(searchQuery),
    prisma.product.findMany({
      where: { id: { in: getRecentlyViewedProductIds(req) }, isActive: true },
      include: productWithReviewsInclude,
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
    const [purchasedItems, myReviews] = await Promise.all([
      prisma.orderItem.findMany({
        where: { order: { userId } },
        distinct: ["productId"],
        select: { productId: true },
      }),
      prisma.review.findMany({
        where: { userId },
        select: { productId: true, rating: true, comment: true },
      }),
    ]);

    purchasedProductIds = purchasedItems.map((item) => item.productId);
    myReviewsByProduct = myReviews.reduce((acc, review) => {
      acc[review.productId] = {
        rating: review.rating,
        comment: review.comment || "",
      };
      return acc;
    }, {});
  }

  const productsWithStats = products.map(mapProductWithReviewStats);

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
      include: productWithReviewsInclude,
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

  const purchased = await prisma.orderItem.findFirst({
    where: {
      productId,
      order: { userId },
    },
    select: { id: true },
  });

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
  const products = await getProducts("", { includeInactive: true });

  res.render("admin", {
    products,
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
    products,
    success: req.query.success || null,
    error: req.query.error || null,
  });
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

  if (!entries.length && !discountEnabledEntries.length) {
    const upsertSetting = prisma.appSetting.upsert({
      where: { key: "promo_discounts_enabled" },
      create: {
        key: "promo_discounts_enabled",
        value: discountsEnabled ? "true" : "false",
      },
      update: { value: discountsEnabled ? "true" : "false" },
    });

    await prisma.$transaction([upsertSetting]);

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
      prisma.appSetting.upsert({
        where: { key: "promo_discounts_enabled" },
        create: {
          key: "promo_discounts_enabled",
          value: discountsEnabled ? "true" : "false",
        },
        update: { value: discountsEnabled ? "true" : "false" },
      }),
      ...(!discountsEnabled
        ? [
            prisma.product.updateMany({
              data: { discountEnabled: false },
            }),
          ]
        : []),
      ...updates,
    ]);
    const updateResults = results.slice(1);
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
    return res.json({
      success: true,
      message: "Discounts updated.",
      discountsEnabled,
    });
  }
  return res.redirect("/admin/promo?success=Discounts+updated");
};

exports.updatePromoSettings = async (req, res) => {
  const current = await getPromoSettings();
  const parsed = parsePromoInput(req.body, req.file, current);

  if (parsed.error) {
    return res.redirect(`/admin?error=${encodeURIComponent(parsed.error)}`);
  }

  const nextSettings = {
    ...parsed.data,
    discountsEnabled: parsed.data.enabled
      ? current.discountsEnabled !== false
      : false,
  };

  await savePromoSettings(nextSettings);
  return res.redirect("/admin/promo?success=Promotion+updated");
};

exports.createProduct = async (req, res) => {
  const parsed = parseProductInput(req.body, req.file);

  if (parsed.error) {
    const products = await getProducts();
    return res.status(400).render("admin", {
      products,
      success: null,
      error: parsed.error,
      formData: req.body,
    });
  }

  try {
    await prisma.product.create({ data: parsed.data });
    return res.redirect("/admin?success=Product+created");
  } catch (error) {
    const products = await getProducts();
    const errorMessage =
      error.code === "P2002"
        ? "A product with this name already exists."
        : "Unable to create product. Please try again.";

    return res.status(400).render("admin", {
      products,
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
