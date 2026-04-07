const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const COMPETITION_ENTRY_RULE_KEYS = {
  comingSoonEnabled: "competition_coming_soon_enabled",
  hideCompetitionsPage: "competition_hide_page_enabled",
  tierOneMinSubtotal: "competition_entry_tier_1_min_subtotal",
  tierOneEntries: "competition_entry_tier_1_entries",
  tierTwoMinSubtotal: "competition_entry_tier_2_min_subtotal",
  tierTwoEntries: "competition_entry_tier_2_entries",
  affiliateBonusEntries: "competition_entry_affiliate_bonus_entries",
};

const COMPETITION_ENTRY_RULE_DEFAULTS = {
  comingSoonEnabled: false,
  hideCompetitionsPage: false,
  tierOneMinSubtotal: 400,
  tierOneEntries: 1,
  tierTwoMinSubtotal: 800,
  tierTwoEntries: 3,
  affiliateBonusEntries: 1,
};

const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedRules = null;
let cachedLoadedAt = 0;

const normalizeCurrency = (value, fallback = 0) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Number(parsed.toFixed(2));
};

const normalizeNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const buildRules = (settingsByKey = {}) => {
  const hasKey = (key) => Object.prototype.hasOwnProperty.call(settingsByKey, key);
  return {
    comingSoonEnabled: hasKey(COMPETITION_ENTRY_RULE_KEYS.comingSoonEnabled)
      ? normalizeBoolean(
          settingsByKey[COMPETITION_ENTRY_RULE_KEYS.comingSoonEnabled],
          COMPETITION_ENTRY_RULE_DEFAULTS.comingSoonEnabled,
        )
      : COMPETITION_ENTRY_RULE_DEFAULTS.comingSoonEnabled,
    hideCompetitionsPage: hasKey(COMPETITION_ENTRY_RULE_KEYS.hideCompetitionsPage)
      ? normalizeBoolean(
          settingsByKey[COMPETITION_ENTRY_RULE_KEYS.hideCompetitionsPage],
          COMPETITION_ENTRY_RULE_DEFAULTS.hideCompetitionsPage,
        )
      : COMPETITION_ENTRY_RULE_DEFAULTS.hideCompetitionsPage,
    tierOneMinSubtotal: hasKey(COMPETITION_ENTRY_RULE_KEYS.tierOneMinSubtotal)
      ? normalizeCurrency(settingsByKey[COMPETITION_ENTRY_RULE_KEYS.tierOneMinSubtotal], COMPETITION_ENTRY_RULE_DEFAULTS.tierOneMinSubtotal)
      : COMPETITION_ENTRY_RULE_DEFAULTS.tierOneMinSubtotal,
    tierOneEntries: hasKey(COMPETITION_ENTRY_RULE_KEYS.tierOneEntries)
      ? normalizeNonNegativeInt(settingsByKey[COMPETITION_ENTRY_RULE_KEYS.tierOneEntries], COMPETITION_ENTRY_RULE_DEFAULTS.tierOneEntries)
      : COMPETITION_ENTRY_RULE_DEFAULTS.tierOneEntries,
    tierTwoMinSubtotal: hasKey(COMPETITION_ENTRY_RULE_KEYS.tierTwoMinSubtotal)
      ? normalizeCurrency(settingsByKey[COMPETITION_ENTRY_RULE_KEYS.tierTwoMinSubtotal], COMPETITION_ENTRY_RULE_DEFAULTS.tierTwoMinSubtotal)
      : COMPETITION_ENTRY_RULE_DEFAULTS.tierTwoMinSubtotal,
    tierTwoEntries: hasKey(COMPETITION_ENTRY_RULE_KEYS.tierTwoEntries)
      ? normalizeNonNegativeInt(settingsByKey[COMPETITION_ENTRY_RULE_KEYS.tierTwoEntries], COMPETITION_ENTRY_RULE_DEFAULTS.tierTwoEntries)
      : COMPETITION_ENTRY_RULE_DEFAULTS.tierTwoEntries,
    affiliateBonusEntries: hasKey(COMPETITION_ENTRY_RULE_KEYS.affiliateBonusEntries)
      ? normalizeNonNegativeInt(settingsByKey[COMPETITION_ENTRY_RULE_KEYS.affiliateBonusEntries], COMPETITION_ENTRY_RULE_DEFAULTS.affiliateBonusEntries)
      : COMPETITION_ENTRY_RULE_DEFAULTS.affiliateBonusEntries,
  };
};

const getCompetitionEntryRules = async () => {
  if (cachedRules && Date.now() - cachedLoadedAt < SETTINGS_CACHE_TTL_MS) {
    return cachedRules;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(COMPETITION_ENTRY_RULE_KEYS) } },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedRules = buildRules(settingsByKey);
    cachedLoadedAt = Date.now();
    return cachedRules;
  } catch (error) {
    logger.warn("competition_entry_rules_load_failed", { error: error.message });
    if (cachedRules) return cachedRules;
    return buildRules({});
  }
};

const saveCompetitionEntryRules = async (rules = {}) => {
  const existing = await getCompetitionEntryRules();
  const normalized = {
    comingSoonEnabled: normalizeBoolean(
      rules.comingSoonEnabled ?? existing.comingSoonEnabled,
      existing.comingSoonEnabled,
    ),
    hideCompetitionsPage: normalizeBoolean(
      rules.hideCompetitionsPage ?? existing.hideCompetitionsPage,
      existing.hideCompetitionsPage,
    ),
    tierOneMinSubtotal: normalizeCurrency(
      rules.tierOneMinSubtotal ?? existing.tierOneMinSubtotal,
      existing.tierOneMinSubtotal,
    ),
    tierOneEntries: normalizeNonNegativeInt(
      rules.tierOneEntries ?? existing.tierOneEntries,
      existing.tierOneEntries,
    ),
    tierTwoMinSubtotal: normalizeCurrency(
      rules.tierTwoMinSubtotal ?? existing.tierTwoMinSubtotal,
      existing.tierTwoMinSubtotal,
    ),
    tierTwoEntries: normalizeNonNegativeInt(
      rules.tierTwoEntries ?? existing.tierTwoEntries,
      existing.tierTwoEntries,
    ),
    affiliateBonusEntries: normalizeNonNegativeInt(
      rules.affiliateBonusEntries ?? existing.affiliateBonusEntries,
      existing.affiliateBonusEntries,
    ),
  };

  const payload = {
    [COMPETITION_ENTRY_RULE_KEYS.comingSoonEnabled]: normalized.comingSoonEnabled
      ? "true"
      : "false",
    [COMPETITION_ENTRY_RULE_KEYS.hideCompetitionsPage]: normalized.hideCompetitionsPage
      ? "true"
      : "false",
    [COMPETITION_ENTRY_RULE_KEYS.tierOneMinSubtotal]: String(normalized.tierOneMinSubtotal),
    [COMPETITION_ENTRY_RULE_KEYS.tierOneEntries]: String(normalized.tierOneEntries),
    [COMPETITION_ENTRY_RULE_KEYS.tierTwoMinSubtotal]: String(normalized.tierTwoMinSubtotal),
    [COMPETITION_ENTRY_RULE_KEYS.tierTwoEntries]: String(normalized.tierTwoEntries),
    [COMPETITION_ENTRY_RULE_KEYS.affiliateBonusEntries]: String(normalized.affiliateBonusEntries),
  };

  const writes = Object.entries(payload).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    }),
  );
  await prisma.$transaction(writes);

  cachedRules = normalized;
  cachedLoadedAt = Date.now();
  return cachedRules;
};

module.exports = {
  COMPETITION_ENTRY_RULE_DEFAULTS,
  COMPETITION_ENTRY_RULE_KEYS,
  getCompetitionEntryRules,
  saveCompetitionEntryRules,
};
