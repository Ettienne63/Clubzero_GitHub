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

const isValidTheme = (id) => THEME_OPTIONS.some((theme) => theme.id === id);

const getSiteTheme = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: SITE_THEME_SETTING_KEY },
    select: { value: true },
  });

  const selected = (setting?.value || "").toString().trim().toLowerCase();
  return isValidTheme(selected) ? selected : DEFAULT_THEME_ID;
};

const saveSiteTheme = async (themeId) => {
  const normalized = (themeId || "").toString().trim().toLowerCase();
  const selected = isValidTheme(normalized) ? normalized : DEFAULT_THEME_ID;

  await prisma.appSetting.upsert({
    where: { key: SITE_THEME_SETTING_KEY },
    create: { key: SITE_THEME_SETTING_KEY, value: selected },
    update: { value: selected },
  });

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
