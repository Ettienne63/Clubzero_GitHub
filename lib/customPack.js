const { getDiscountedPrice } = require("./pricing");

const BOTTLES_PER_CASE = 12;
const ALLOWED_EQUAL_SPLITS = new Set([1, 2, 3, 4, 6, 12]);

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const toPositiveInt = (value, fallback = 0) => {
  const parsed = toInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
};

const toDiscountPercent = (value) => {
  const parsed = toNonNegativeNumber(value, 0);
  if (parsed > 90) {
    return 90;
  }
  return parsed;
};

const getProductAvailableBottles = (product) => {
  const caseStock = toPositiveInt(product?.websiteStock, 0);
  const loose = Math.max(0, toInt(product?.looseBottleStock, 0));
  return caseStock * BOTTLES_PER_CASE + loose;
};

const getProductAvailableCases = (product) =>
  Math.floor(getProductAvailableBottles(product) / BOTTLES_PER_CASE);

const getBottleUnitPrice = (product, discountsEnabled) => {
  const casePrice = getDiscountedPrice(
    Number(product?.price || 0),
    discountsEnabled && product?.discountEnabled !== false
      ? Number(product?.discountPercent || 0)
      : 0,
  );
  return casePrice / BOTTLES_PER_CASE;
};

const getMixLabPricingFromSettings = (promoSettings, discountsEnabled) => {
  const baseCasePrice = toNonNegativeNumber(promoSettings?.mixLabCasePrice, 0);
  if (!(baseCasePrice > 0)) {
    return {
      hasFixedPrice: false,
      baseCasePrice: null,
      discountedCasePrice: null,
      discountPercent: 0,
      discountEnabled: false,
    };
  }

  const discountEnabled =
    discountsEnabled && promoSettings?.mixLabDiscountEnabled !== false;
  const discountPercent = discountEnabled
    ? toDiscountPercent(promoSettings?.mixLabDiscountPercent)
    : 0;
  const discountedCasePrice = getDiscountedPrice(baseCasePrice, discountPercent);

  return {
    hasFixedPrice: true,
    baseCasePrice,
    discountedCasePrice,
    discountPercent,
    discountEnabled,
  };
};

const parseCustomPackConfig = (value) => {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? value
      : [];
  const rows = Array.isArray(source)
    ? source
    : Object.values(source || {});

  return rows
    .map((row) => ({
      productId: toPositiveInt(row?.productId, 0),
      bottlesPerPack: toPositiveInt(row?.bottlesPerPack, 0),
      productName: (row?.productName || "").toString().trim() || null,
    }))
    .filter((row) => row.productId > 0 && row.bottlesPerPack > 0);
};

const buildEqualSplitPackConfig = (productIds) => {
  const selected = Array.from(
    new Set(
      (Array.isArray(productIds) ? productIds : [productIds])
        .map((id) => toPositiveInt(id, 0))
        .filter((id) => id > 0),
    ),
  );

  if (!selected.length) {
    return { error: "Select at least one flavour." };
  }

  if (!ALLOWED_EQUAL_SPLITS.has(selected.length)) {
    return {
      error: "Choose 1, 2, 3, 4, 6, or 12 flavours so the 12-pack splits equally.",
    };
  }

  const bottlesPerPack = BOTTLES_PER_CASE / selected.length;
  return {
    config: selected.map((productId) => ({ productId, bottlesPerPack })),
  };
};

const normalizePackConfigKey = (config) =>
  parseCustomPackConfig(config)
    .sort((a, b) => a.productId - b.productId)
    .map((entry) => `${entry.productId}:${entry.bottlesPerPack}`)
    .join("|");

const resolveCustomPack = ({
  config,
  productsById,
  quantity = 1,
  discountsEnabled = false,
  mixLabPricing = null,
}) => {
  const packConfig = parseCustomPackConfig(config);
  if (!packConfig.length) {
    return { error: "Custom pack setup is invalid." };
  }

  const totalBottlesPerPack = packConfig.reduce(
    (sum, entry) => sum + entry.bottlesPerPack,
    0,
  );
  if (totalBottlesPerPack !== BOTTLES_PER_CASE) {
    return { error: "Custom pack must contain exactly 12 bottles." };
  }

  const resolvedEntries = [];
  const useFixedMixLabPrice = Boolean(
    mixLabPricing &&
      mixLabPricing.hasFixedPrice &&
      Number(mixLabPricing.discountedCasePrice || 0) > 0,
  );
  const fixedPackPrice = useFixedMixLabPrice
    ? Number(mixLabPricing.discountedCasePrice || 0)
    : 0;
  let perPackPrice = useFixedMixLabPrice ? fixedPackPrice : 0;

  for (const entry of packConfig) {
    const product = productsById.get(entry.productId);
    if (!product || product.isActive === false) {
      return { error: "One or more flavours in this custom pack are unavailable." };
    }

    const bottleUnitPrice = useFixedMixLabPrice
      ? fixedPackPrice / BOTTLES_PER_CASE
      : getBottleUnitPrice(product, discountsEnabled);
    if (!useFixedMixLabPrice) {
      const entrySubtotalPerPack = bottleUnitPrice * entry.bottlesPerPack;
      perPackPrice += entrySubtotalPerPack;
    }

    resolvedEntries.push({
      productId: product.id,
      productName: product.name,
      bottlesPerPack: entry.bottlesPerPack,
      bottleUnitPrice,
      availableBottles: getProductAvailableBottles(product),
      availableCases: getProductAvailableCases(product),
    });
  }

  const normalizedQuantity = Math.max(1, toPositiveInt(quantity, 1));
  const totalPrice = perPackPrice * normalizedQuantity;

  return {
    quantity: normalizedQuantity,
    entries: resolvedEntries,
    perPackPrice,
    totalPrice,
    label: `Custom 12-Pack (${resolvedEntries
      .map((entry) => `${entry.productName} ${entry.bottlesPerPack}`)
      .join(", ")})`,
  };
};

const aggregateBottleDemand = (entries, quantity) => {
  const normalizedQuantity = Math.max(1, toPositiveInt(quantity, 1));
  const demand = new Map();

  (entries || []).forEach((entry) => {
    const productId = toPositiveInt(entry?.productId, 0);
    const bottlesPerPack = toPositiveInt(entry?.bottlesPerPack, 0);
    if (!productId || !bottlesPerPack) {
      return;
    }
    const current = demand.get(productId) || 0;
    demand.set(productId, current + bottlesPerPack * normalizedQuantity);
  });

  return demand;
};

module.exports = {
  BOTTLES_PER_CASE,
  ALLOWED_EQUAL_SPLITS,
  parseCustomPackConfig,
  buildEqualSplitPackConfig,
  normalizePackConfigKey,
  resolveCustomPack,
  aggregateBottleDemand,
  getProductAvailableBottles,
  getProductAvailableCases,
  getBottleUnitPrice,
  getMixLabPricingFromSettings,
};
