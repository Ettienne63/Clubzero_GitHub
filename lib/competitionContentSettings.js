const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const COMPETITION_CONTENT_SETTING_KEYS = {
  heroBadge: "competition_hero_badge",
  heroTitle: "competition_hero_title",
  heroSubtitle: "competition_hero_subtitle",
  heroImageUrl: "competition_hero_image_url",
  heroCtaLabel: "competition_hero_cta_label",
  heroCtaUrl: "competition_hero_cta_url",
  currentTitle: "competition_current_title",
  prize: "competition_prize",
  deadlineLabel: "competition_deadline_label",
  competitionStartsAtIso: "competition_starts_at_iso",
  endsAtIso: "competition_ends_at_iso",
  winnerRevealAtIso: "competition_winner_reveal_at_iso",
  winnerDateLabel: "competition_winner_date_label",
  eligibility: "competition_eligibility",
  entryRulesText: "competition_entry_rules_text",
  termsText: "competition_terms_text",
  winner1Name: "competition_winner_1_name",
  winner1City: "competition_winner_1_city",
  winner1WonAt: "competition_winner_1_won_at",
  winner1Prize: "competition_winner_1_prize",
  winner2Name: "competition_winner_2_name",
  winner2City: "competition_winner_2_city",
  winner2WonAt: "competition_winner_2_won_at",
  winner2Prize: "competition_winner_2_prize",
  winner3Name: "competition_winner_3_name",
  winner3City: "competition_winner_3_city",
  winner3WonAt: "competition_winner_3_won_at",
  winner3Prize: "competition_winner_3_prize",
  faq1Question: "competition_faq_1_question",
  faq1Answer: "competition_faq_1_answer",
  faq2Question: "competition_faq_2_question",
  faq2Answer: "competition_faq_2_answer",
  faq3Question: "competition_faq_3_question",
  faq3Answer: "competition_faq_3_answer",
};

const COMPETITION_CONTENT_DEFAULTS = {
  heroBadge: "Live Competition",
  heroTitle: "Win Big With Club Zero",
  heroSubtitle:
    "Place your order, get entered automatically, and stand a chance to win this month's prize.",
  heroImageUrl: "/images/Mango,Grape,tropical flavours with desription.jpeg",
  heroCtaLabel: "Shop & Enter",
  heroCtaUrl: "/auth/products",
  currentTitle: "Club Zero Ultimate Refresh Bundle",
  prize: "1x mini fridge + 12 mixed cases + Club Zero merch hamper worth R6,000",
  deadlineLabel: "May 31, 2026 at 23:59 SAST",
  competitionStartsAtIso: "",
  endsAtIso: "2026-05-31T23:59:00+02:00",
  winnerRevealAtIso: "",
  winnerDateLabel: "Automatically revealed 3 days after the competition ends",
  eligibility:
    "Open to South African residents aged 18+. Winner is selected at random from valid entries.",
  entryRulesText:
    "Buy any Club Zero order over R400 = 1 entry\nBuy any Club Zero order over R800 = 3 entries\nUse an approved affiliate code at checkout = +1 bonus entry",
  termsText:
    "Only fully paid orders placed before the deadline qualify.\nEntries are void if fraud, chargebacks, or abuse is detected.\nPrize is non-transferable and not exchangeable for cash.\nClub Zero may replace unavailable items with equal value alternatives.\nBy entering, winners agree to first-name-and-city public winner announcements.",
  winner1Name: "Naledi M.",
  winner1City: "Pretoria",
  winner1WonAt: "March 2026",
  winner1Prize: "R2,000 Club Zero hamper",
  winner2Name: "Johan P.",
  winner2City: "Johannesburg",
  winner2WonAt: "February 2026",
  winner2Prize: "Monthly flavour bundle",
  winner3Name: "Thando K.",
  winner3City: "Cape Town",
  winner3WonAt: "January 2026",
  winner3Prize: "Club Zero starter crate",
  faq1Question: "How many entries can I earn?",
  faq1Answer:
    "Every qualifying order generates entries automatically. Larger order values can unlock more entries based on the current competition rules.",
  faq2Question: "When is the winner revealed?",
  faq2Answer:
    "Winners are drawn privately when the competition closes and revealed publicly 3 days later on our social channels and website.",
  faq3Question: "How do I know my entry is counted?",
  faq3Answer:
    "If your order qualifies under the current rules and payment is successful, your entry is counted automatically.",
};

const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedCompetitionContentSettings = null;
let cachedCompetitionContentLoadedAt = 0;

const buildCompetitionContentSettings = (settingsByKey = {}) => {
  const hasKey = (key) =>
    Object.prototype.hasOwnProperty.call(settingsByKey, key);
  const readString = (key, fallback) =>
    hasKey(key) ? String(settingsByKey[key] ?? "") : fallback;

  return Object.entries(COMPETITION_CONTENT_SETTING_KEYS).reduce(
    (acc, [field, key]) => {
      acc[field] = readString(key, COMPETITION_CONTENT_DEFAULTS[field] || "");
      return acc;
    },
    {},
  );
};

const getCompetitionContentSettings = async () => {
  if (
    cachedCompetitionContentSettings &&
    Date.now() - cachedCompetitionContentLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedCompetitionContentSettings;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(COMPETITION_CONTENT_SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedCompetitionContentSettings =
      buildCompetitionContentSettings(settingsByKey);
    cachedCompetitionContentLoadedAt = Date.now();
    return cachedCompetitionContentSettings;
  } catch (error) {
    logger.warn("competition_content_settings_load_failed", {
      error: error.message,
    });
    if (cachedCompetitionContentSettings) {
      return cachedCompetitionContentSettings;
    }
    return buildCompetitionContentSettings({});
  }
};

const saveCompetitionContentSettings = async (settings = {}) => {
  const current = await getCompetitionContentSettings();
  const payload = Object.entries(COMPETITION_CONTENT_SETTING_KEYS).reduce(
    (acc, [field, key]) => {
      const nextValue = String(settings[field] ?? "");
      const currentValue = String(current[field] ?? "");
      if (nextValue !== currentValue) {
        acc[key] = nextValue;
      }
      return acc;
    },
    {},
  );

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

  cachedCompetitionContentSettings = {
    ...current,
    ...settings,
  };
  cachedCompetitionContentLoadedAt = Date.now();
  return cachedCompetitionContentSettings;
};

module.exports = {
  COMPETITION_CONTENT_DEFAULTS,
  COMPETITION_CONTENT_SETTING_KEYS,
  getCompetitionContentSettings,
  saveCompetitionContentSettings,
};
