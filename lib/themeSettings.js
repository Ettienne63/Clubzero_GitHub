const { prisma } = require("../prisma/lib/prisma");

const SITE_THEME_SETTING_KEY = "site_theme";

const THEME_OPTIONS = [
  {
    id: "sunset",
    name: "Tropical Coconut",
    description: "Warm orange and coral tones.",
  },
  {
    id: "forest",
    name: "Forest Clean",
    description: "Natural green and earthy tones.",
  },
  {
    id: "mango",
    name: "Mango Passion Fruit",
    description: "Bright orange tropical tones.",
  },
  {
    id: "grape",
    name: "Grape Raspberry",
    description: "Rich reddish berry tones.",
  },
];

const DEFAULT_THEME_ID = "sunset";
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedThemeId = null;
let cachedThemeLoadedAt = 0;

const isValidTheme = (id) => THEME_OPTIONS.some((theme) => theme.id === id);

const getSiteTheme = async () => {
  if (
    cachedThemeId &&
    Date.now() - cachedThemeLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedThemeId;
  }

  const setting = await prisma.appSetting.findUnique({
    where: { key: SITE_THEME_SETTING_KEY },
    select: { value: true },
  });

  const selected = (setting?.value || "").toString().trim().toLowerCase();
  cachedThemeId = isValidTheme(selected) ? selected : DEFAULT_THEME_ID;
  cachedThemeLoadedAt = Date.now();
  return cachedThemeId;
};

const saveSiteTheme = async (themeId) => {
  const normalized = (themeId || "").toString().trim().toLowerCase();
  const selected = isValidTheme(normalized) ? normalized : DEFAULT_THEME_ID;

  await prisma.appSetting.upsert({
    where: { key: SITE_THEME_SETTING_KEY },
    create: { key: SITE_THEME_SETTING_KEY, value: selected },
    update: { value: selected },
  });

  cachedThemeId = selected;
  cachedThemeLoadedAt = Date.now();
  return selected;
};

module.exports = {
  SITE_THEME_SETTING_KEY,
  THEME_OPTIONS,
  DEFAULT_THEME_ID,
  isValidTheme,
  getSiteTheme,
  saveSiteTheme,
};
