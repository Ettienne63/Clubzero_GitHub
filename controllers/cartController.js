const { prisma } = require("../prisma/lib/prisma");
const { getDiscountedPrice } = require("../lib/pricing");
const { getPromoSettings } = require("../lib/promoSettings");
const {
  BOTTLES_PER_CASE,
  parseCustomPackConfig,
  buildEqualSplitPackConfig,
  normalizePackConfigKey,
  resolveCustomPack,
  aggregateBottleDemand,
  getProductAvailableBottles,
  getProductAvailableCases,
  getMixLabPricingFromSettings,
} = require("../lib/customPack");

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);
const isAjaxRequest = (req) =>
  req.xhr || req.get("X-Requested-With") === "XMLHttpRequest";
const getEffectiveDiscountPercent = (product, discountsEnabled) =>
  discountsEnabled && product?.discountEnabled !== false
    ? product?.discountPercent
    : 0;
const formatCaseCount = (count) => {
  const normalized = Number(count || 0);
  const label = normalized === 1 ? "case" : "cases";
  return `${normalized} ${label}`;
};
const appendQueryParam = (path, key, value) => {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
};
const getSafeReturnTo = (req) => {
  const raw = (req.body?.returnTo || req.get("referer") || "")
    .toString()
    .trim();

  if (!raw) {
    return "/auth/products";
  }

  try {
    const parsed = new URL(raw, "http://local");
    const path = `${parsed.pathname || ""}${parsed.search || ""}`;
    if (path.startsWith("/auth") && !path.startsWith("//")) {
      return path;
    }
  } catch (error) {
    if (raw.startsWith("/auth") && !raw.startsWith("//")) {
      return raw;
    }
  }

  return "/auth/products";
};

const parseSelectedProductIds = (rawValue) => {
  const source = Array.isArray(rawValue)
    ? rawValue
    : typeof rawValue === "undefined"
      ? []
      : [rawValue];

  return Array.from(
    new Set(
      source
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
};

const touchCartActivity = async (userId) => {
  if (!Number.isInteger(userId)) {
    return;
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastCartActivityAt: new Date(),
      lastAbandonedCartEmailAt: null,
      abandonedCartEmailCount: 0,
    },
  });
};

const getCustomPackProductIds = (cartItems) => {
  const ids = new Set();
  (cartItems || []).forEach((item) => {
    if (!item?.isCustomPack) {
      return;
    }
    parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
      ids.add(entry.productId);
    });
  });
  return Array.from(ids);
};

const loadCustomPackProductsById = async (cartItems) => {
  const ids = getCustomPackProductIds(cartItems);
  if (!ids.length) {
    return new Map();
  }

  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      price: true,
      discountPercent: true,
      discountEnabled: true,
      websiteStock: true,
      looseBottleStock: true,
      isActive: true,
    },
  });
  return new Map(products.map((product) => [product.id, product]));
};

const buildCartSummary = async (
  userId,
  discountsEnabled = false,
  mixLabPricing = null,
) => {
  const cartItemsRaw = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { id: "desc" },
  });
  const customProductsById = await loadCustomPackProductsById(cartItemsRaw);

  const cartItems = cartItemsRaw.map((item) => {
    const quantity = Number(item.quantity || 0);

    if (item.isCustomPack) {
      const resolved = resolveCustomPack({
        config: item.customPackConfig,
        productsById: customProductsById,
        quantity,
        discountsEnabled,
        mixLabPricing,
      });

      if (resolved.error) {
        return {
          ...item,
          displayName: "Custom 12-Pack",
          bottles: quantity * BOTTLES_PER_CASE,
          subtotal: 0,
          unitPrice: 0,
          customPackEntries: [],
          unavailableReason: resolved.error,
          isUnavailable: true,
        };
      }

      return {
        ...item,
        displayName: resolved.label,
        bottles: quantity * BOTTLES_PER_CASE,
        subtotal: resolved.totalPrice,
        unitPrice: resolved.perPackPrice,
        customPackEntries: resolved.entries,
        isUnavailable: resolved.entries.some((entry) => !entry.productId),
      };
    }

    const product = item.product;
    const unitPrice = getDiscountedPrice(
      Number(product?.price || 0),
      getEffectiveDiscountPercent(product, discountsEnabled),
    );
    return {
      ...item,
      displayName: product?.name || "Product",
      bottles: quantity * BOTTLES_PER_CASE,
      subtotal: unitPrice * quantity,
      unitPrice,
      customPackEntries: [],
      isUnavailable: !product || product.isActive === false,
      availableCases: getProductAvailableCases(product),
    };
  });

  const total = cartItems.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const totalCases = cartItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const hasUnavailableItems = cartItems.some((item) => item.isUnavailable);

  return {
    cartItems,
    total,
    totalCases,
    hasUnavailableItems,
    customProductsById,
  };
};

const buildBottleDemandForCartItems = (cartItems, override = null) => {
  const demand = new Map();

  (cartItems || []).forEach((item) => {
    const isTarget = override && Number(item.id) === Number(override.itemId);
    const quantity = isTarget
      ? Number(override.quantity || 0)
      : Number(item.quantity || 0);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return;
    }

    if (item.isCustomPack) {
      const customDemand = aggregateBottleDemand(item.customPackConfig, quantity);
      customDemand.forEach((value, productId) => {
        demand.set(productId, (demand.get(productId) || 0) + value);
      });
      return;
    }

    if (Number.isInteger(item.productId)) {
      demand.set(
        item.productId,
        (demand.get(item.productId) || 0) + quantity * BOTTLES_PER_CASE,
      );
    }
  });

  return demand;
};

const findInsufficientBottleStock = (demandByProductId, productsById) => {
  for (const [productId, neededBottles] of demandByProductId.entries()) {
    const product = productsById.get(productId);
    const availableBottles = getProductAvailableBottles(product);
    if (!product || product.isActive === false || neededBottles > availableBottles) {
      return {
        productName: product?.name || "A selected flavour",
        neededBottles,
        availableBottles,
      };
    }
  }
  return null;
};

exports.getCart = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const promoSettings = await getPromoSettings();
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );
  const mixLabPricing = getMixLabPricingFromSettings(
    promoSettings,
    discountsEnabled,
  );
  const summary = await buildCartSummary(userId, discountsEnabled, mixLabPricing);

  return res.render("cart", {
    cartItems: summary.cartItems,
    total: summary.total,
    totalCases: summary.totalCases,
    success: req.query.success || null,
    error: req.query.error || null,
    hasUnavailableItems: summary.hasUnavailableItems,
    discountsEnabled,
  });
};

exports.addToCart = async (req, res) => {
  const userId = getUserId(req);
  const productId = Number.parseInt(req.body.productId, 10);
  const quantity = Math.max(1, Number.parseInt(req.body.quantity, 10) || 1);
  const returnTo = getSafeReturnTo(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true, websiteStock: true, looseBottleStock: true },
  });

  if (!product) {
    return res.redirect(
      appendQueryParam(
        returnTo,
        "error",
        "This product is no longer available.",
      ),
    );
  }

  const existingCartItems = await prisma.cartItem.findMany({
    where: { userId },
    select: {
      id: true,
      productId: true,
      quantity: true,
      isCustomPack: true,
      customPackConfig: true,
    },
  });
  const bottleDemand = buildBottleDemandForCartItems(existingCartItems);
  const currentDemandBottles = Number(bottleDemand.get(productId) || 0);
  const availableBottles = getProductAvailableBottles(product);
  const remainingBottles = Math.max(0, availableBottles - currentDemandBottles);
  const availableCases = Math.floor(remainingBottles / BOTTLES_PER_CASE);

  if (availableCases <= 0) {
    return res.redirect(
      appendQueryParam(
        returnTo,
        "error",
        `Only ${formatCaseCount(availableCases)} left right now. Please reduce your quantity or check back soon.`,
      ),
    );
  }

  const quantityToAdd = Math.min(quantity, availableCases);

  if (quantityToAdd <= 0) {
    return res.redirect(
      appendQueryParam(
        returnTo,
        "error",
        `Only ${formatCaseCount(availableCases)} left right now. Please reduce your quantity or check back soon.`,
      ),
    );
  }

  await prisma.cartItem.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    create: {
      userId,
      productId,
      quantity: quantityToAdd,
      isCustomPack: false,
      customPackConfig: null,
    },
    update: {
      quantity: { increment: quantityToAdd },
    },
  });
  await touchCartActivity(userId);

  const successMessage =
    quantityToAdd < quantity
      ? `Added ${formatCaseCount(quantityToAdd)} to your cart. Only ${formatCaseCount(availableCases)} available right now.`
      : `Added ${formatCaseCount(quantityToAdd)} to your cart.`;

  return res.redirect(appendQueryParam(returnTo, "success", successMessage));
};

exports.addCustomPackToCart = async (req, res) => {
  const userId = getUserId(req);
  const returnTo = getSafeReturnTo(req);
  const selectedProductIds = parseSelectedProductIds(req.body.productIds);
  const packCount = Math.max(1, Number.parseInt(req.body.packCount, 10) || 1);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const split = buildEqualSplitPackConfig(selectedProductIds);
  if (split.error) {
    return res.redirect(appendQueryParam(returnTo, "error", split.error));
  }

  const productIds = split.config.map((entry) => entry.productId);
  const [products, cartItems] = await Promise.all([
    prisma.product.findMany({
      where: {
        id: { in: productIds },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        isActive: true,
        websiteStock: true,
        looseBottleStock: true,
        price: true,
        discountPercent: true,
        discountEnabled: true,
      },
    }),
    prisma.cartItem.findMany({
      where: { userId },
      select: {
        id: true,
        productId: true,
        quantity: true,
        isCustomPack: true,
        customPackConfig: true,
      },
    }),
  ]);

  if (products.length !== productIds.length) {
    return res.redirect(
      appendQueryParam(
        returnTo,
        "error",
        "One or more selected flavours are no longer available.",
      ),
    );
  }

  const productsById = new Map(products.map((product) => [product.id, product]));
  const existingDemand = buildBottleDemandForCartItems(cartItems);
  const newDemand = aggregateBottleDemand(split.config, packCount);
  newDemand.forEach((value, productId) => {
    existingDemand.set(productId, (existingDemand.get(productId) || 0) + value);
  });
  const missingProductIds = Array.from(existingDemand.keys()).filter(
    (productId) => !productsById.has(productId),
  );
  if (missingProductIds.length) {
    const extraProducts = await prisma.product.findMany({
      where: { id: { in: missingProductIds } },
      select: {
        id: true,
        name: true,
        isActive: true,
        websiteStock: true,
        looseBottleStock: true,
      },
    });
    extraProducts.forEach((product) => {
      productsById.set(product.id, product);
    });
  }

  const stockIssue = findInsufficientBottleStock(existingDemand, productsById);
  if (stockIssue) {
    const availableCases = Math.floor(stockIssue.availableBottles / BOTTLES_PER_CASE);
    return res.redirect(
      appendQueryParam(
        returnTo,
        "error",
        `${stockIssue.productName} only has ${formatCaseCount(availableCases)} worth of stock available right now.`,
      ),
    );
  }

  const targetKey = normalizePackConfigKey(split.config);
  const existingPackItem = cartItems.find(
    (item) =>
      item.isCustomPack &&
      normalizePackConfigKey(item.customPackConfig) === targetKey,
  );

  if (existingPackItem) {
    await prisma.cartItem.update({
      where: { id: existingPackItem.id },
      data: {
        quantity: { increment: packCount },
      },
    });
  } else {
    await prisma.cartItem.create({
      data: {
        userId,
        productId: null,
        isCustomPack: true,
        customPackConfig: split.config,
        quantity: packCount,
      },
    });
  }

  await touchCartActivity(userId);
  return res.redirect(
    appendQueryParam(
      returnTo,
      "success",
      `Added ${packCount} custom 12-pack${packCount === 1 ? "" : "s"} to your cart.`,
    ),
  );
};

exports.updateCartItem = async (req, res) => {
  const userId = getUserId(req);
  const itemId = Number.parseInt(req.params.id, 10);
  const quantity = Number.parseInt(req.body.quantity, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(itemId)) {
    return res.status(400).send("Invalid cart item id");
  }

  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      productId: true,
      quantity: true,
      isCustomPack: true,
      customPackConfig: true,
    },
  });
  const cartItem = cartItems.find((item) => item.id === itemId);

  if (!cartItem || cartItem.userId !== userId) {
    return res.status(404).send("Cart item not found");
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    await prisma.cartItem.delete({ where: { id: itemId } });
    await touchCartActivity(userId);

    if (isAjaxRequest(req)) {
      const promoSettings = await getPromoSettings();
      const discountsEnabled = Boolean(
        promoSettings?.enabled && promoSettings?.discountsEnabled,
      );
      const mixLabPricing = getMixLabPricingFromSettings(
        promoSettings,
        discountsEnabled,
      );
      const summary = await buildCartSummary(
        userId,
        discountsEnabled,
        mixLabPricing,
      );

      return res.json({
        success: true,
        removed: true,
        itemId,
        total: summary.total,
        cartCount: summary.totalCases,
      });
    }

    return res.redirect("/auth/cart");
  }

  const productIdsNeeded = new Set();
  cartItems.forEach((item) => {
    if (!item.isCustomPack && Number.isInteger(item.productId)) {
      productIdsNeeded.add(item.productId);
      return;
    }
    parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
      productIdsNeeded.add(entry.productId);
    });
  });

  const stockProducts = await prisma.product.findMany({
    where: { id: { in: Array.from(productIdsNeeded) } },
    select: {
      id: true,
      name: true,
      isActive: true,
      websiteStock: true,
      looseBottleStock: true,
    },
  });
  const productsById = new Map(stockProducts.map((product) => [product.id, product]));
  const proposedDemand = buildBottleDemandForCartItems(cartItems, {
    itemId,
    quantity,
  });
  const stockIssue = findInsufficientBottleStock(proposedDemand, productsById);
  if (stockIssue) {
    const availableCases = Math.floor(stockIssue.availableBottles / BOTTLES_PER_CASE);
    if (isAjaxRequest(req)) {
      return res.status(400).json({
        success: false,
        message: `Only ${formatCaseCount(availableCases)} left for ${stockIssue.productName}.`,
      });
    }
    return res.redirect(
      `/auth/cart?error=${encodeURIComponent(
        `Only ${formatCaseCount(availableCases)} left for ${stockIssue.productName}.`,
      )}`,
    );
  }

  await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  });
  await touchCartActivity(userId);

  if (isAjaxRequest(req)) {
    const promoSettings = await getPromoSettings();
    const discountsEnabled = Boolean(
      promoSettings?.enabled && promoSettings?.discountsEnabled,
    );
    const mixLabPricing = getMixLabPricingFromSettings(
      promoSettings,
      discountsEnabled,
    );
    const summary = await buildCartSummary(userId, discountsEnabled, mixLabPricing);
    const updated = summary.cartItems.find((item) => item.id === itemId);

    return res.json({
      success: true,
      removed: false,
      itemId,
      quantity: Number(updated?.quantity || quantity),
      bottles: Number(updated?.bottles || quantity * BOTTLES_PER_CASE),
      subtotal: Number(updated?.subtotal || 0),
      total: Number(summary.total || 0),
      cartCount: Number(summary.totalCases || 0),
    });
  }

  return res.redirect("/auth/cart");
};

exports.removeCartItem = async (req, res) => {
  const userId = getUserId(req);
  const itemId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(itemId)) {
    return res.status(400).send("Invalid cart item id");
  }

  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, userId: true },
  });

  if (!cartItem || cartItem.userId !== userId) {
    return res.status(404).send("Cart item not found");
  }

  await prisma.cartItem.delete({ where: { id: itemId } });
  await touchCartActivity(userId);

  return res.redirect("/auth/cart");
};
