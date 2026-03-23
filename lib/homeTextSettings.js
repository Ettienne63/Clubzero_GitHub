const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const HOME_TEXT_SETTING_KEYS = {
  cleanTitle: "home_text_clean_title",
  cleanIntro: "home_text_clean_intro",
  cleanCard1Icon: "home_text_clean_card_1_icon",
  cleanCard1Title: "home_text_clean_card_1_title",
  cleanCard1Body: "home_text_clean_card_1_body",
  cleanCard2Icon: "home_text_clean_card_2_icon",
  cleanCard2Title: "home_text_clean_card_2_title",
  cleanCard2Body: "home_text_clean_card_2_body",
  cleanCard3Icon: "home_text_clean_card_3_icon",
  cleanCard3Title: "home_text_clean_card_3_title",
  cleanCard3Body: "home_text_clean_card_3_body",
  cleanCard4Icon: "home_text_clean_card_4_icon",
  cleanCard4Title: "home_text_clean_card_4_title",
  cleanCard4Body: "home_text_clean_card_4_body",
  insideIcon: "home_text_inside_icon",
  insideTitle: "home_text_inside_title",
  insideBody: "home_text_inside_body",
  insidePoint1Title: "home_text_inside_point_1_title",
  insidePoint1Body: "home_text_inside_point_1_body",
  insidePoint2Title: "home_text_inside_point_2_title",
  insidePoint2Body: "home_text_inside_point_2_body",
  insidePoint3Title: "home_text_inside_point_3_title",
  insidePoint3Body: "home_text_inside_point_3_body",
  meetKicker: "home_text_meet_kicker",
  meetTitle: "home_text_meet_title",
  chooseTitle: "home_text_choose_title",
  chooseIntroLine1: "home_text_choose_intro_line_1",
  chooseIntroLine2: "home_text_choose_intro_line_2",
  chooseCard1Icon: "home_text_choose_card_1_icon",
  chooseCard1Title: "home_text_choose_card_1_title",
  chooseCard1Body: "home_text_choose_card_1_body",
  chooseCard2Icon: "home_text_choose_card_2_icon",
  chooseCard2Title: "home_text_choose_card_2_title",
  chooseCard2Body: "home_text_choose_card_2_body",
  chooseCard3Icon: "home_text_choose_card_3_icon",
  chooseCard3Title: "home_text_choose_card_3_title",
  chooseCard3Body: "home_text_choose_card_3_body",
  benefit1Title: "home_text_benefit_1_title",
  benefit1Body: "home_text_benefit_1_body",
  benefit1Lead: "home_text_benefit_1_lead",
  benefit1Bullet1: "home_text_benefit_1_bullet_1",
  benefit1Bullet2: "home_text_benefit_1_bullet_2",
  benefit1Bullet3: "home_text_benefit_1_bullet_3",
  benefit2Title: "home_text_benefit_2_title",
  benefit2Body1: "home_text_benefit_2_body_1",
  benefit2Body2: "home_text_benefit_2_body_2",
  benefit3Title: "home_text_benefit_3_title",
  benefit3Line1: "home_text_benefit_3_line_1",
  benefit3Line2: "home_text_benefit_3_line_2",
  benefit3Line3: "home_text_benefit_3_line_3",
  benefit3Line4: "home_text_benefit_3_line_4",
  benefit3Footer: "home_text_benefit_3_footer",
  reviewsKicker: "home_text_reviews_kicker",
  reviewsTitle: "home_text_reviews_title",
  reviewsEmpty: "home_text_reviews_empty",
  affiliateKicker: "home_text_affiliate_kicker",
  affiliateTitle: "home_text_affiliate_title",
  affiliateBody: "home_text_affiliate_body",
  affiliateChip1: "home_text_affiliate_chip_1",
  affiliateChip2: "home_text_affiliate_chip_2",
  affiliateChip3: "home_text_affiliate_chip_3",
  affiliateCtaLabel: "home_text_affiliate_cta_label",
  affiliateStat1Label: "home_text_affiliate_stat_1_label",
  affiliateStat1Value: "home_text_affiliate_stat_1_value",
  affiliateStat2Label: "home_text_affiliate_stat_2_label",
  affiliateStat2Value: "home_text_affiliate_stat_2_value",
  affiliateStat3Label: "home_text_affiliate_stat_3_label",
  affiliateStat3Value: "home_text_affiliate_stat_3_value",
  bottomCtaTitle: "home_text_bottom_cta_title",
  bottomCtaBody: "home_text_bottom_cta_body",
  bottomCtaButtonLabel: "home_text_bottom_cta_button_label",
};

const HOME_TEXT_DEFAULTS = {
  cleanTitle: "Clean refreshment, built for everyday",
  cleanIntro:
    "Club Zero is a sparkling hydration drink crafted for people who want bright flavor without the sugar crash.",
  cleanCard1Icon: "0 Sugar",
  cleanCard1Title: "Zero added sugar",
  cleanCard1Body: "Built to keep your day light without sacrificing taste.",
  cleanCard2Icon: "Low Cal",
  cleanCard2Title: "Low calorie refresh",
  cleanCard2Body:
    "A crisp option that fits workouts, workdays, and weekends.",
  cleanCard3Icon: "Real Taste",
  cleanCard3Title: "Bold flavor profiles",
  cleanCard3Body:
    "Bright, fruit-forward flavors that stay vibrant to the last sip.",
  cleanCard4Icon: "Anytime",
  cleanCard4Title: "All-day friendly",
  cleanCard4Body: "Hydration you can enjoy at any time of day.",
  insideIcon: "Inside",
  insideTitle: "What makes Club Zero different",
  insideBody:
    "We focus on clean refreshment with bold flavor and a smoother finish.",
  insidePoint1Title: "Sparkling base",
  insidePoint1Body: "for a crisp, uplifting texture.",
  insidePoint2Title: "Balanced sweetness",
  insidePoint2Body: "so flavor stays bright, never heavy.",
  insidePoint3Title: "Flavor-forward",
  insidePoint3Body: "tropical and citrus profiles that stand out.",
  meetKicker: "Meet Club Zero",
  meetTitle: "A better way to hydrate - without the sugar, without the compromise.",
  chooseTitle: "Why People Choose Club Zero",
  chooseIntroLine1:
    "Tired of plain water but don't want the sugar and guilt that comes with soft drinks?",
  chooseIntroLine2: "Club Zero gives you the best of both worlds:",
  chooseCard1Icon: "Flavor",
  chooseCard1Title: "Big Taste",
  chooseCard1Body:
    "Crisp, refreshing flavor profiles made to keep every sip interesting.",
  chooseCard2Icon: "Clean",
  chooseCard2Title: "Less Sugar",
  chooseCard2Body:
    "Built around cleaner choices so you can enjoy more, guilt-free.",
  chooseCard3Icon: "Daily",
  chooseCard3Title: "Everyday Fit",
  chooseCard3Body:
    "Easy to pair with your routine from workouts to late-day refresh.",
  benefit1Title: "Feel good, every day",
  benefit1Body:
    "Whether you're at work, at the gym, or on the go, Club Zero is made to fit into your everyday life.",
  benefit1Lead: "Highlights",
  benefit1Bullet1: "Light and refreshing",
  benefit1Bullet2: "Full of flavour",
  benefit1Bullet3: "Easy to enjoy anytime",
  benefit2Title: "Premium quality, made for South Africans",
  benefit2Body1:
    "Proudly born and bottled in South Africa, Club Zero is designed for real people living real lives.",
  benefit2Body2:
    "You get a premium product at a price that still feels good.",
  benefit3Title: "The smarter choice",
  benefit3Line1: "Great taste.",
  benefit3Line2: "No sugar.",
  benefit3Line3: "Better ingredients.",
  benefit3Line4: "Affordable.",
  benefit3Footer: "That's the Club Zero difference.",
  reviewsKicker: "Reviews",
  reviewsTitle: "What customers are saying",
  reviewsEmpty: "Keep a look out for what people are saying about our products!",
  affiliateKicker: "Affiliate Program",
  affiliateTitle: "Earn by sharing Club Zero",
  affiliateBody:
    "Get your personal referral link instantly and earn commission on every order your community places.",
  affiliateChip1: "Instant access",
  affiliateChip2: "Track earnings",
  affiliateChip3: "Flexible payouts",
  affiliateCtaLabel: "Become an Affiliate",
  affiliateStat1Label: "Referral link setup",
  affiliateStat1Value: "Instant",
  affiliateStat2Label: "Commission rate",
  affiliateStat2Value: "5%",
  affiliateStat3Label: "Tracking",
  affiliateStat3Value: "Live dashboard",
  bottomCtaTitle: "Ready for your next favorite drink?",
  bottomCtaBody: "Explore our latest flavors and refresh your routine.",
  bottomCtaButtonLabel: "Browse Products",
};
const SETTINGS_CACHE_TTL_MS = 60 * 1000;
let cachedHomeTextSettings = null;
let cachedHomeTextLoadedAt = 0;

const buildHomeTextSettings = (settingsByKey = {}) => {
  const hasKey = (key) =>
    Object.prototype.hasOwnProperty.call(settingsByKey, key);

  const readString = (key, fallback) => {
    if (!hasKey(key)) return fallback;
    const value = String(settingsByKey[key] ?? "");
    return value.trim() ? value : fallback;
  };

  return {
    cleanTitle: readString(HOME_TEXT_SETTING_KEYS.cleanTitle, HOME_TEXT_DEFAULTS.cleanTitle),
    cleanIntro: readString(HOME_TEXT_SETTING_KEYS.cleanIntro, HOME_TEXT_DEFAULTS.cleanIntro),
    cleanCard1Icon: readString(HOME_TEXT_SETTING_KEYS.cleanCard1Icon, HOME_TEXT_DEFAULTS.cleanCard1Icon),
    cleanCard1Title: readString(HOME_TEXT_SETTING_KEYS.cleanCard1Title, HOME_TEXT_DEFAULTS.cleanCard1Title),
    cleanCard1Body: readString(HOME_TEXT_SETTING_KEYS.cleanCard1Body, HOME_TEXT_DEFAULTS.cleanCard1Body),
    cleanCard2Icon: readString(HOME_TEXT_SETTING_KEYS.cleanCard2Icon, HOME_TEXT_DEFAULTS.cleanCard2Icon),
    cleanCard2Title: readString(HOME_TEXT_SETTING_KEYS.cleanCard2Title, HOME_TEXT_DEFAULTS.cleanCard2Title),
    cleanCard2Body: readString(HOME_TEXT_SETTING_KEYS.cleanCard2Body, HOME_TEXT_DEFAULTS.cleanCard2Body),
    cleanCard3Icon: readString(HOME_TEXT_SETTING_KEYS.cleanCard3Icon, HOME_TEXT_DEFAULTS.cleanCard3Icon),
    cleanCard3Title: readString(HOME_TEXT_SETTING_KEYS.cleanCard3Title, HOME_TEXT_DEFAULTS.cleanCard3Title),
    cleanCard3Body: readString(HOME_TEXT_SETTING_KEYS.cleanCard3Body, HOME_TEXT_DEFAULTS.cleanCard3Body),
    cleanCard4Icon: readString(HOME_TEXT_SETTING_KEYS.cleanCard4Icon, HOME_TEXT_DEFAULTS.cleanCard4Icon),
    cleanCard4Title: readString(HOME_TEXT_SETTING_KEYS.cleanCard4Title, HOME_TEXT_DEFAULTS.cleanCard4Title),
    cleanCard4Body: readString(HOME_TEXT_SETTING_KEYS.cleanCard4Body, HOME_TEXT_DEFAULTS.cleanCard4Body),
    insideIcon: readString(HOME_TEXT_SETTING_KEYS.insideIcon, HOME_TEXT_DEFAULTS.insideIcon),
    insideTitle: readString(HOME_TEXT_SETTING_KEYS.insideTitle, HOME_TEXT_DEFAULTS.insideTitle),
    insideBody: readString(HOME_TEXT_SETTING_KEYS.insideBody, HOME_TEXT_DEFAULTS.insideBody),
    insidePoint1Title: readString(HOME_TEXT_SETTING_KEYS.insidePoint1Title, HOME_TEXT_DEFAULTS.insidePoint1Title),
    insidePoint1Body: readString(HOME_TEXT_SETTING_KEYS.insidePoint1Body, HOME_TEXT_DEFAULTS.insidePoint1Body),
    insidePoint2Title: readString(HOME_TEXT_SETTING_KEYS.insidePoint2Title, HOME_TEXT_DEFAULTS.insidePoint2Title),
    insidePoint2Body: readString(HOME_TEXT_SETTING_KEYS.insidePoint2Body, HOME_TEXT_DEFAULTS.insidePoint2Body),
    insidePoint3Title: readString(HOME_TEXT_SETTING_KEYS.insidePoint3Title, HOME_TEXT_DEFAULTS.insidePoint3Title),
    insidePoint3Body: readString(HOME_TEXT_SETTING_KEYS.insidePoint3Body, HOME_TEXT_DEFAULTS.insidePoint3Body),
    meetKicker: readString(HOME_TEXT_SETTING_KEYS.meetKicker, HOME_TEXT_DEFAULTS.meetKicker),
    meetTitle: readString(HOME_TEXT_SETTING_KEYS.meetTitle, HOME_TEXT_DEFAULTS.meetTitle),
    chooseTitle: readString(HOME_TEXT_SETTING_KEYS.chooseTitle, HOME_TEXT_DEFAULTS.chooseTitle),
    chooseIntroLine1: readString(HOME_TEXT_SETTING_KEYS.chooseIntroLine1, HOME_TEXT_DEFAULTS.chooseIntroLine1),
    chooseIntroLine2: readString(HOME_TEXT_SETTING_KEYS.chooseIntroLine2, HOME_TEXT_DEFAULTS.chooseIntroLine2),
    chooseCard1Icon: readString(HOME_TEXT_SETTING_KEYS.chooseCard1Icon, HOME_TEXT_DEFAULTS.chooseCard1Icon),
    chooseCard1Title: readString(HOME_TEXT_SETTING_KEYS.chooseCard1Title, HOME_TEXT_DEFAULTS.chooseCard1Title),
    chooseCard1Body: readString(HOME_TEXT_SETTING_KEYS.chooseCard1Body, HOME_TEXT_DEFAULTS.chooseCard1Body),
    chooseCard2Icon: readString(HOME_TEXT_SETTING_KEYS.chooseCard2Icon, HOME_TEXT_DEFAULTS.chooseCard2Icon),
    chooseCard2Title: readString(HOME_TEXT_SETTING_KEYS.chooseCard2Title, HOME_TEXT_DEFAULTS.chooseCard2Title),
    chooseCard2Body: readString(HOME_TEXT_SETTING_KEYS.chooseCard2Body, HOME_TEXT_DEFAULTS.chooseCard2Body),
    chooseCard3Icon: readString(HOME_TEXT_SETTING_KEYS.chooseCard3Icon, HOME_TEXT_DEFAULTS.chooseCard3Icon),
    chooseCard3Title: readString(HOME_TEXT_SETTING_KEYS.chooseCard3Title, HOME_TEXT_DEFAULTS.chooseCard3Title),
    chooseCard3Body: readString(HOME_TEXT_SETTING_KEYS.chooseCard3Body, HOME_TEXT_DEFAULTS.chooseCard3Body),
    benefit1Title: readString(HOME_TEXT_SETTING_KEYS.benefit1Title, HOME_TEXT_DEFAULTS.benefit1Title),
    benefit1Body: readString(HOME_TEXT_SETTING_KEYS.benefit1Body, HOME_TEXT_DEFAULTS.benefit1Body),
    benefit1Lead: readString(HOME_TEXT_SETTING_KEYS.benefit1Lead, HOME_TEXT_DEFAULTS.benefit1Lead),
    benefit1Bullet1: readString(HOME_TEXT_SETTING_KEYS.benefit1Bullet1, HOME_TEXT_DEFAULTS.benefit1Bullet1),
    benefit1Bullet2: readString(HOME_TEXT_SETTING_KEYS.benefit1Bullet2, HOME_TEXT_DEFAULTS.benefit1Bullet2),
    benefit1Bullet3: readString(HOME_TEXT_SETTING_KEYS.benefit1Bullet3, HOME_TEXT_DEFAULTS.benefit1Bullet3),
    benefit2Title: readString(HOME_TEXT_SETTING_KEYS.benefit2Title, HOME_TEXT_DEFAULTS.benefit2Title),
    benefit2Body1: readString(HOME_TEXT_SETTING_KEYS.benefit2Body1, HOME_TEXT_DEFAULTS.benefit2Body1),
    benefit2Body2: readString(HOME_TEXT_SETTING_KEYS.benefit2Body2, HOME_TEXT_DEFAULTS.benefit2Body2),
    benefit3Title: readString(HOME_TEXT_SETTING_KEYS.benefit3Title, HOME_TEXT_DEFAULTS.benefit3Title),
    benefit3Line1: readString(HOME_TEXT_SETTING_KEYS.benefit3Line1, HOME_TEXT_DEFAULTS.benefit3Line1),
    benefit3Line2: readString(HOME_TEXT_SETTING_KEYS.benefit3Line2, HOME_TEXT_DEFAULTS.benefit3Line2),
    benefit3Line3: readString(HOME_TEXT_SETTING_KEYS.benefit3Line3, HOME_TEXT_DEFAULTS.benefit3Line3),
    benefit3Line4: readString(HOME_TEXT_SETTING_KEYS.benefit3Line4, HOME_TEXT_DEFAULTS.benefit3Line4),
    benefit3Footer: readString(HOME_TEXT_SETTING_KEYS.benefit3Footer, HOME_TEXT_DEFAULTS.benefit3Footer),
    reviewsKicker: readString(HOME_TEXT_SETTING_KEYS.reviewsKicker, HOME_TEXT_DEFAULTS.reviewsKicker),
    reviewsTitle: readString(HOME_TEXT_SETTING_KEYS.reviewsTitle, HOME_TEXT_DEFAULTS.reviewsTitle),
    reviewsEmpty: readString(HOME_TEXT_SETTING_KEYS.reviewsEmpty, HOME_TEXT_DEFAULTS.reviewsEmpty),
    affiliateKicker: readString(HOME_TEXT_SETTING_KEYS.affiliateKicker, HOME_TEXT_DEFAULTS.affiliateKicker),
    affiliateTitle: readString(HOME_TEXT_SETTING_KEYS.affiliateTitle, HOME_TEXT_DEFAULTS.affiliateTitle),
    affiliateBody: readString(HOME_TEXT_SETTING_KEYS.affiliateBody, HOME_TEXT_DEFAULTS.affiliateBody),
    affiliateChip1: readString(HOME_TEXT_SETTING_KEYS.affiliateChip1, HOME_TEXT_DEFAULTS.affiliateChip1),
    affiliateChip2: readString(HOME_TEXT_SETTING_KEYS.affiliateChip2, HOME_TEXT_DEFAULTS.affiliateChip2),
    affiliateChip3: readString(HOME_TEXT_SETTING_KEYS.affiliateChip3, HOME_TEXT_DEFAULTS.affiliateChip3),
    affiliateCtaLabel: readString(HOME_TEXT_SETTING_KEYS.affiliateCtaLabel, HOME_TEXT_DEFAULTS.affiliateCtaLabel),
    affiliateStat1Label: readString(HOME_TEXT_SETTING_KEYS.affiliateStat1Label, HOME_TEXT_DEFAULTS.affiliateStat1Label),
    affiliateStat1Value: readString(HOME_TEXT_SETTING_KEYS.affiliateStat1Value, HOME_TEXT_DEFAULTS.affiliateStat1Value),
    affiliateStat2Label: readString(HOME_TEXT_SETTING_KEYS.affiliateStat2Label, HOME_TEXT_DEFAULTS.affiliateStat2Label),
    affiliateStat2Value: readString(HOME_TEXT_SETTING_KEYS.affiliateStat2Value, HOME_TEXT_DEFAULTS.affiliateStat2Value),
    affiliateStat3Label: readString(HOME_TEXT_SETTING_KEYS.affiliateStat3Label, HOME_TEXT_DEFAULTS.affiliateStat3Label),
    affiliateStat3Value: readString(HOME_TEXT_SETTING_KEYS.affiliateStat3Value, HOME_TEXT_DEFAULTS.affiliateStat3Value),
    bottomCtaTitle: readString(HOME_TEXT_SETTING_KEYS.bottomCtaTitle, HOME_TEXT_DEFAULTS.bottomCtaTitle),
    bottomCtaBody: readString(HOME_TEXT_SETTING_KEYS.bottomCtaBody, HOME_TEXT_DEFAULTS.bottomCtaBody),
    bottomCtaButtonLabel: readString(HOME_TEXT_SETTING_KEYS.bottomCtaButtonLabel, HOME_TEXT_DEFAULTS.bottomCtaButtonLabel),
  };
};

const getHomeTextSettings = async () => {
  if (
    cachedHomeTextSettings &&
    Date.now() - cachedHomeTextLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedHomeTextSettings;
  }

  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(HOME_TEXT_SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    cachedHomeTextSettings = buildHomeTextSettings(settingsByKey);
    cachedHomeTextLoadedAt = Date.now();
    return cachedHomeTextSettings;
  } catch (error) {
    logger.warn("home_text_settings_load_failed", { error: error.message });
    if (cachedHomeTextSettings) {
      return cachedHomeTextSettings;
    }
    return buildHomeTextSettings({});
  }
};

const saveHomeTextSettings = async (settings = {}) => {
  const payload = Object.entries(HOME_TEXT_SETTING_KEYS).reduce((acc, [field, key]) => {
    acc[key] = settings[field] ?? "";
    return acc;
  }, {});

  const writes = Object.entries(payload).map(([key, value]) =>
    prisma.appSetting.upsert({
      where: { key },
      create: { key, value: String(value) },
      update: { value: String(value) },
    }),
  );

  await prisma.$transaction(writes);
  cachedHomeTextSettings = buildHomeTextSettings(payload);
  cachedHomeTextLoadedAt = Date.now();
  return cachedHomeTextSettings;
};

module.exports = {
  HOME_TEXT_DEFAULTS,
  HOME_TEXT_SETTING_KEYS,
  getHomeTextSettings,
  saveHomeTextSettings,
};
