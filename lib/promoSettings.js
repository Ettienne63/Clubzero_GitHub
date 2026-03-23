const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const PROMO_SETTING_KEYS = {
  enabled: "promo_enabled",
  discountsEnabled: "promo_discounts_enabled",
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
};

const PROMO_DEFAULTS = {
  enabled: false,
  discountsEnabled: true,
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

module.exports = {
  PROMO_DEFAULTS,
  PROMO_SETTING_KEYS,
  getPromoSettings,
  savePromoSettings,
};
