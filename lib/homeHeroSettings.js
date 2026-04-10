const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const HERO_SETTING_KEYS = {
  logoUrl: "home_hero_logo_url",
  badge: "home_hero_badge",
  title: "home_hero_title",
  subtitle: "home_hero_subtitle",
  chipOne: "home_hero_chip_one",
  chipTwo: "home_hero_chip_two",
  chipThree: "home_hero_chip_three",
  primaryLabel: "home_hero_primary_label",
  primaryUrl: "home_hero_primary_url",
  secondaryLabel: "home_hero_secondary_label",
  secondaryUrl: "home_hero_secondary_url",
  imageUrl: "home_hero_image_url",
};

const HERO_DEFAULTS = {
  logoUrl: "",
  badge: "Club Zero",
  title: "Refresh Your Day",
  subtitle: "Zero sugar. Low calories. Big flavor energy.",
  chipOne: "0g Added Sugar",
  chipTwo: "Low Calories",
  chipThree: "Bright Taste",
  primaryLabel: "Shop Now",
  primaryUrl: "/auth/products",
  secondaryLabel: "Learn More",
  secondaryUrl: "/about",
  imageUrl: "/images/Mango,passion,tropical flavours.jpeg",
};
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedHomeHeroSettings = null;
let cachedHomeHeroLoadedAt = 0;

const buildHeroSettings = (settingsByKey = {}) => {
  const hasKey = (key) =>
    Object.prototype.hasOwnProperty.call(settingsByKey, key);
  const readString = (key, fallback) =>
    hasKey(key) ? String(settingsByKey[key] ?? "") : fallback;

  return {
    logoUrl: readString(HERO_SETTING_KEYS.logoUrl, HERO_DEFAULTS.logoUrl),
    badge: readString(HERO_SETTING_KEYS.badge, HERO_DEFAULTS.badge),
    title: readString(HERO_SETTING_KEYS.title, HERO_DEFAULTS.title),
    subtitle: readString(HERO_SETTING_KEYS.subtitle, HERO_DEFAULTS.subtitle),
    chipOne: readString(HERO_SETTING_KEYS.chipOne, HERO_DEFAULTS.chipOne),
    chipTwo: readString(HERO_SETTING_KEYS.chipTwo, HERO_DEFAULTS.chipTwo),
    chipThree: readString(HERO_SETTING_KEYS.chipThree, HERO_DEFAULTS.chipThree),
    primaryLabel: readString(
      HERO_SETTING_KEYS.primaryLabel,
      HERO_DEFAULTS.primaryLabel,
    ),
    primaryUrl: readString(
      HERO_SETTING_KEYS.primaryUrl,
      HERO_DEFAULTS.primaryUrl,
    ),
    secondaryLabel: readString(
      HERO_SETTING_KEYS.secondaryLabel,
      HERO_DEFAULTS.secondaryLabel,
    ),
    secondaryUrl: readString(
      HERO_SETTING_KEYS.secondaryUrl,
      HERO_DEFAULTS.secondaryUrl,
    ),
    imageUrl: readString(HERO_SETTING_KEYS.imageUrl, HERO_DEFAULTS.imageUrl),
  };
};

const getHomeHeroSettings = async () => {
  if (
    cachedHomeHeroSettings &&
    Date.now() - cachedHomeHeroLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedHomeHeroSettings;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(HERO_SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedHomeHeroSettings = buildHeroSettings(settingsByKey);
    cachedHomeHeroLoadedAt = Date.now();
    return cachedHomeHeroSettings;
  } catch (error) {
    logger.warn("home_hero_settings_load_failed", { error: error.message });
    if (cachedHomeHeroSettings) {
      return cachedHomeHeroSettings;
    }
    return buildHeroSettings({});
  }
};

const saveHomeHeroSettings = async (settings) => {
  const current = await getHomeHeroSettings();
  const payload = Object.entries(HERO_SETTING_KEYS).reduce((acc, [field, key]) => {
    const nextValue = String(settings[field] ?? "");
    const currentValue = String(current[field] ?? "");
    if (nextValue !== currentValue) {
      acc[key] = nextValue;
    }
    return acc;
  }, {});

  const writes = Object.entries(payload).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    }),
  );

  if (writes.length) {
    await prisma.$transaction(writes);
  }

  cachedHomeHeroSettings = {
    ...current,
    ...settings,
  };
  cachedHomeHeroLoadedAt = Date.now();
  return cachedHomeHeroSettings;
};

module.exports = {
  HERO_DEFAULTS,
  HERO_SETTING_KEYS,
  getHomeHeroSettings,
  saveHomeHeroSettings,
};
