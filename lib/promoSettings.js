const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const PROMO_SETTING_KEYS = {
  enabled: "promo_enabled",
  discountsEnabled: "promo_discounts_enabled",
  mixLabCasePrice: "mix_lab_case_price",
  mixLabDiscountPercent: "mix_lab_discount_percent",
  mixLabDiscountEnabled: "mix_lab_discount_enabled",
  badge: "promo_badge",
  title: "promo_title",
  subtitle: "promo_subtitle",
  body: "promo_body",
  ctaLabel: "promo_cta_label",
  ctaUrl: "promo_cta_url",
  secondaryLabel: "promo_secondary_label",
  secondaryUrl: "promo_secondary_url",
  imageUrl: "promo_image_url",
  finePrint: "promo_fine_print",
  countdownEnabled: "promo_countdown_enabled",
  countdownPrefix: "promo_countdown_prefix",
  countdownEndDate: "promo_countdown_end_date",
};

const PROMO_DEFAULTS = {
  enabled: false,
  discountsEnabled: true,
  mixLabCasePrice: "",
  mixLabDiscountPercent: 0,
  mixLabDiscountEnabled: true,
  badge: "Limited Offer",
  title: "Seasonal Promo Drop",
  subtitle: "Bright flavor, limited pricing.",
  body: "Celebrate the season with limited pricing on select Club Zero cases.",
  ctaLabel: "Shop the promo",
  ctaUrl: "/auth/products",
  secondaryLabel: "Learn more",
  secondaryUrl: "/about",
  imageUrl: "/images/Mango,passion,tropical flavours.jpeg",
  finePrint: "Available while supplies last.",
  countdownEnabled: false,
  countdownPrefix: "Ends in",
  countdownEndDate: "",
};
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedPromoSettings = null;
let cachedPromoLoadedAt = 0;

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return fallback;
};

const normalizeNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampDiscountPercent = (value) => {
  const parsed = normalizeNumber(value, 0);
  if (parsed < 0) return 0;
  if (parsed > 90) return 90;
  return Number(parsed.toFixed(2));
};

const normalizeMixLabCasePrice = (value) => {
  if (value === null || typeof value === "undefined") {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "";
  }
  return parsed.toFixed(2);
};

const buildPromoSettings = (settingsByKey = {}) => {
  const hasKey = (key) =>
    Object.prototype.hasOwnProperty.call(settingsByKey, key);
  const readString = (key, fallback) =>
    hasKey(key) ? String(settingsByKey[key] ?? "") : fallback;

  return {
    enabled: hasKey(PROMO_SETTING_KEYS.enabled)
      ? normalizeBoolean(settingsByKey[PROMO_SETTING_KEYS.enabled], false)
      : PROMO_DEFAULTS.enabled,
    discountsEnabled: hasKey(PROMO_SETTING_KEYS.discountsEnabled)
      ? normalizeBoolean(
          settingsByKey[PROMO_SETTING_KEYS.discountsEnabled],
          PROMO_DEFAULTS.discountsEnabled,
        )
      : PROMO_DEFAULTS.discountsEnabled,
    mixLabCasePrice: readString(
      PROMO_SETTING_KEYS.mixLabCasePrice,
      PROMO_DEFAULTS.mixLabCasePrice,
    ),
    mixLabDiscountPercent: hasKey(PROMO_SETTING_KEYS.mixLabDiscountPercent)
      ? clampDiscountPercent(settingsByKey[PROMO_SETTING_KEYS.mixLabDiscountPercent])
      : PROMO_DEFAULTS.mixLabDiscountPercent,
    mixLabDiscountEnabled: hasKey(PROMO_SETTING_KEYS.mixLabDiscountEnabled)
      ? normalizeBoolean(
          settingsByKey[PROMO_SETTING_KEYS.mixLabDiscountEnabled],
          PROMO_DEFAULTS.mixLabDiscountEnabled,
        )
      : PROMO_DEFAULTS.mixLabDiscountEnabled,
    badge: readString(PROMO_SETTING_KEYS.badge, PROMO_DEFAULTS.badge),
    title: readString(PROMO_SETTING_KEYS.title, PROMO_DEFAULTS.title),
    subtitle: readString(PROMO_SETTING_KEYS.subtitle, PROMO_DEFAULTS.subtitle),
    body: readString(PROMO_SETTING_KEYS.body, PROMO_DEFAULTS.body),
    ctaLabel: readString(PROMO_SETTING_KEYS.ctaLabel, PROMO_DEFAULTS.ctaLabel),
    ctaUrl: readString(PROMO_SETTING_KEYS.ctaUrl, PROMO_DEFAULTS.ctaUrl),
    secondaryLabel: readString(
      PROMO_SETTING_KEYS.secondaryLabel,
      PROMO_DEFAULTS.secondaryLabel,
    ),
    secondaryUrl: readString(
      PROMO_SETTING_KEYS.secondaryUrl,
      PROMO_DEFAULTS.secondaryUrl,
    ),
    imageUrl: readString(PROMO_SETTING_KEYS.imageUrl, PROMO_DEFAULTS.imageUrl),
    finePrint: readString(
      PROMO_SETTING_KEYS.finePrint,
      PROMO_DEFAULTS.finePrint,
    ),
    countdownEnabled: hasKey(PROMO_SETTING_KEYS.countdownEnabled)
      ? normalizeBoolean(
          settingsByKey[PROMO_SETTING_KEYS.countdownEnabled],
          PROMO_DEFAULTS.countdownEnabled,
        )
      : PROMO_DEFAULTS.countdownEnabled,
    countdownPrefix: readString(
      PROMO_SETTING_KEYS.countdownPrefix,
      PROMO_DEFAULTS.countdownPrefix,
    ),
    countdownEndDate: readString(
      PROMO_SETTING_KEYS.countdownEndDate,
      PROMO_DEFAULTS.countdownEndDate,
    ),
  };
};

const getPromoSettings = async () => {
  if (
    cachedPromoSettings &&
    Date.now() - cachedPromoLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedPromoSettings;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: {
        key: {
          in: Object.values(PROMO_SETTING_KEYS),
        },
      },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedPromoSettings = buildPromoSettings(settingsByKey);
    cachedPromoLoadedAt = Date.now();
    return cachedPromoSettings;
  } catch (error) {
    logger.warn("promo_settings_load_failed", { error: error.message });
    if (cachedPromoSettings) {
      return cachedPromoSettings;
    }
    return buildPromoSettings({});
  }
};

const savePromoSettings = async (settings) => {
  const payload = {
    [PROMO_SETTING_KEYS.enabled]: settings.enabled ? "true" : "false",
    [PROMO_SETTING_KEYS.discountsEnabled]: settings.discountsEnabled
      ? "true"
      : "false",
    [PROMO_SETTING_KEYS.mixLabCasePrice]: normalizeMixLabCasePrice(
      settings.mixLabCasePrice,
    ),
    [PROMO_SETTING_KEYS.mixLabDiscountPercent]: String(
      clampDiscountPercent(settings.mixLabDiscountPercent),
    ),
    [PROMO_SETTING_KEYS.mixLabDiscountEnabled]: settings.mixLabDiscountEnabled === false
      ? "false"
      : "true",
    [PROMO_SETTING_KEYS.badge]: settings.badge ?? "",
    [PROMO_SETTING_KEYS.title]: settings.title ?? "",
    [PROMO_SETTING_KEYS.subtitle]: settings.subtitle ?? "",
    [PROMO_SETTING_KEYS.body]: settings.body ?? "",
    [PROMO_SETTING_KEYS.ctaLabel]: settings.ctaLabel ?? "",
    [PROMO_SETTING_KEYS.ctaUrl]: settings.ctaUrl ?? "",
    [PROMO_SETTING_KEYS.secondaryLabel]: settings.secondaryLabel ?? "",
    [PROMO_SETTING_KEYS.secondaryUrl]: settings.secondaryUrl ?? "",
    [PROMO_SETTING_KEYS.imageUrl]: settings.imageUrl ?? "",
    [PROMO_SETTING_KEYS.finePrint]: settings.finePrint ?? "",
    [PROMO_SETTING_KEYS.countdownEnabled]: settings.countdownEnabled
      ? "true"
      : "false",
    [PROMO_SETTING_KEYS.countdownPrefix]: settings.countdownPrefix ?? "",
    [PROMO_SETTING_KEYS.countdownEndDate]: settings.countdownEndDate ?? "",
  };

  const writes = Object.entries(payload).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    }),
  );

  await prisma.$transaction(writes);
  cachedPromoSettings = buildPromoSettings(payload);
  cachedPromoLoadedAt = Date.now();
  return cachedPromoSettings;
};

const setPromoDiscountsEnabled = async (enabled) => {
  const value = enabled ? "true" : "false";
  await prisma.appSetting.upsert({
    where: { key: PROMO_SETTING_KEYS.discountsEnabled },
    create: {
      key: PROMO_SETTING_KEYS.discountsEnabled,
      value,
    },
    update: { value },
  });

  if (cachedPromoSettings) {
    cachedPromoSettings = {
      ...cachedPromoSettings,
      discountsEnabled: Boolean(enabled),
    };
    cachedPromoLoadedAt = Date.now();
  } else {
    cachedPromoLoadedAt = 0;
  }

  return Boolean(enabled);
};

const setMixLabCasePrice = async (mixLabCasePrice) => {
  const value = normalizeMixLabCasePrice(mixLabCasePrice);
  await prisma.appSetting.upsert({
    where: { key: PROMO_SETTING_KEYS.mixLabCasePrice },
    create: {
      key: PROMO_SETTING_KEYS.mixLabCasePrice,
      value,
    },
    update: { value },
  });

  if (cachedPromoSettings) {
    cachedPromoSettings = {
      ...cachedPromoSettings,
      mixLabCasePrice: value,
    };
    cachedPromoLoadedAt = Date.now();
  } else {
    cachedPromoLoadedAt = 0;
  }

  return value;
};

const setMixLabDiscountSettings = async ({
  mixLabDiscountPercent,
  mixLabDiscountEnabled,
}) => {
  const percent = String(clampDiscountPercent(mixLabDiscountPercent));
  const enabled = mixLabDiscountEnabled === false ? "false" : "true";

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: PROMO_SETTING_KEYS.mixLabDiscountPercent },
      create: {
        key: PROMO_SETTING_KEYS.mixLabDiscountPercent,
        value: percent,
      },
      update: { value: percent },
    }),
    prisma.appSetting.upsert({
      where: { key: PROMO_SETTING_KEYS.mixLabDiscountEnabled },
      create: {
        key: PROMO_SETTING_KEYS.mixLabDiscountEnabled,
        value: enabled,
      },
      update: { value: enabled },
    }),
  ]);

  if (cachedPromoSettings) {
    cachedPromoSettings = {
      ...cachedPromoSettings,
      mixLabDiscountPercent: Number.parseFloat(percent),
      mixLabDiscountEnabled: enabled === "true",
    };
    cachedPromoLoadedAt = Date.now();
  } else {
    cachedPromoLoadedAt = 0;
  }
};

const invalidatePromoSettingsCache = () => {
  cachedPromoSettings = null;
  cachedPromoLoadedAt = 0;
};

module.exports = {
  PROMO_DEFAULTS,
  PROMO_SETTING_KEYS,
  getPromoSettings,
  savePromoSettings,
  setPromoDiscountsEnabled,
  setMixLabCasePrice,
  setMixLabDiscountSettings,
  invalidatePromoSettingsCache,
};
