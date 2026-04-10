const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const FIXED_DELIVERY_COUNTRY = "South Africa";

const DELIVERY_SETTING_KEYS = {
  enabled: "delivery_pricing_enabled",
  fixedFee: "delivery_fixed_fee",
  freeDeliveryThreshold: "delivery_free_delivery_threshold",
  defaultCountry: "delivery_default_country",
};

const DELIVERY_DEFAULTS = {
  enabled: true,
  fixedFee: 0,
  freeDeliveryThreshold: 600,
  defaultCountry: FIXED_DELIVERY_COUNTRY,
};

const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedSettings = null;
let cachedLoadedAt = 0;

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
};

const roundCurrency = (value) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Number(parsed.toFixed(2));
};

const buildSettings = (settingsByKey = {}) => {
  const hasKey = (key) => Object.prototype.hasOwnProperty.call(settingsByKey, key);

  return {
    enabled: hasKey(DELIVERY_SETTING_KEYS.enabled)
      ? normalizeBoolean(settingsByKey[DELIVERY_SETTING_KEYS.enabled], DELIVERY_DEFAULTS.enabled)
      : DELIVERY_DEFAULTS.enabled,
    fixedFee: hasKey(DELIVERY_SETTING_KEYS.fixedFee)
      ? roundCurrency(settingsByKey[DELIVERY_SETTING_KEYS.fixedFee])
      : DELIVERY_DEFAULTS.fixedFee,
    freeDeliveryThreshold: hasKey(DELIVERY_SETTING_KEYS.freeDeliveryThreshold)
      ? roundCurrency(settingsByKey[DELIVERY_SETTING_KEYS.freeDeliveryThreshold])
      : DELIVERY_DEFAULTS.freeDeliveryThreshold,
    defaultCountry: FIXED_DELIVERY_COUNTRY,
  };
};

const getDeliveryPricingSettings = async () => {
  if (cachedSettings && Date.now() - cachedLoadedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedSettings;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: {
        key: {
          in: Object.values(DELIVERY_SETTING_KEYS),
        },
      },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedSettings = buildSettings(settingsByKey);
    cachedLoadedAt = Date.now();
    return cachedSettings;
  } catch (error) {
    logger.warn("delivery_settings_load_failed", { error: error.message });
    if (cachedSettings) {
      return cachedSettings;
    }
    return buildSettings({});
  }
};

const saveDeliveryPricingSettings = async (settings = {}) => {
  const existing = await getDeliveryPricingSettings();

  const enabled = typeof settings.enabled === "boolean"
    ? settings.enabled
    : Boolean(existing.enabled);

  const candidateFee = settings.fixedFee ?? existing.fixedFee ?? DELIVERY_DEFAULTS.fixedFee;
  const fixedFee = roundCurrency(candidateFee);
  if (!Number.isFinite(fixedFee) || fixedFee < 0) {
    throw new Error("Delivery fee must be zero or more.");
  }
  const candidateThreshold =
    settings.freeDeliveryThreshold ??
    existing.freeDeliveryThreshold ??
    DELIVERY_DEFAULTS.freeDeliveryThreshold;
  const freeDeliveryThreshold = roundCurrency(candidateThreshold);
  if (!Number.isFinite(freeDeliveryThreshold) || freeDeliveryThreshold < 0) {
    throw new Error("Free delivery threshold must be zero or more.");
  }

  const normalized = {
    enabled,
    fixedFee,
    freeDeliveryThreshold,
    defaultCountry: FIXED_DELIVERY_COUNTRY,
  };

  const payload = {
    [DELIVERY_SETTING_KEYS.enabled]: normalized.enabled ? "true" : "false",
    [DELIVERY_SETTING_KEYS.fixedFee]: String(normalized.fixedFee),
    [DELIVERY_SETTING_KEYS.freeDeliveryThreshold]: String(normalized.freeDeliveryThreshold),
    [DELIVERY_SETTING_KEYS.defaultCountry]: normalized.defaultCountry,
  };

  const writes = Object.entries(payload).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    }),
  );

  await prisma.$transaction(writes);

  cachedSettings = normalized;
  cachedLoadedAt = Date.now();
  return cachedSettings;
};

// Backward-compat helpers (no longer used by admin UI).
const parseTierRows = () => [];
const formatTierRows = () => "";

const quoteDeliveryFee = async (_delivery = {}, overrideSettings = null) => {
  const settings = overrideSettings || (await getDeliveryPricingSettings());
  const fee = settings.enabled ? roundCurrency(settings.fixedFee) : 0;

  return {
    enabled: Boolean(settings.enabled),
    distanceKm: 0,
    fee,
    tierMaxKm: null,
    destinationQuery: "fixed_fee",
    originLabel: "Fixed fee",
    tiers: [],
  };
};

module.exports = {
  DELIVERY_DEFAULTS,
  DELIVERY_SETTING_KEYS,
  getDeliveryPricingSettings,
  saveDeliveryPricingSettings,
  parseTierRows,
  formatTierRows,
  quoteDeliveryFee,
};
