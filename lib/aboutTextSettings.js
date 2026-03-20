const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");

const ABOUT_TEXT_SETTING_KEYS = {
  introImageUrl: "about_text_intro_image_url",
  introKicker: "about_text_intro_kicker",
  introTitle: "about_text_intro_title",
  introLead: "about_text_intro_lead",
  introBody: "about_text_intro_body",
  introChip1: "about_text_intro_chip_1",
  introChip2: "about_text_intro_chip_2",
  introChip3: "about_text_intro_chip_3",
  storyTitle: "about_text_story_title",
  storyBody1: "about_text_story_body_1",
  storyBody2: "about_text_story_body_2",
  missionTitle: "about_text_mission_title",
  missionBody: "about_text_mission_body",
  visionTitle: "about_text_vision_title",
  visionBody: "about_text_vision_body",
  promiseKicker: "about_text_promise_kicker",
  promiseTitle: "about_text_promise_title",
  promiseCard1Icon: "about_text_promise_card_1_icon",
  promiseCard1Title: "about_text_promise_card_1_title",
  promiseCard1Body: "about_text_promise_card_1_body",
  promiseCard2Icon: "about_text_promise_card_2_icon",
  promiseCard2Title: "about_text_promise_card_2_title",
  promiseCard2Body: "about_text_promise_card_2_body",
  promiseCard3Icon: "about_text_promise_card_3_icon",
  promiseCard3Title: "about_text_promise_card_3_title",
  promiseCard3Body: "about_text_promise_card_3_body",
  valuesTitle: "about_text_values_title",
  valuesSubtitle: "about_text_values_subtitle",
  value1Tag: "about_text_value_1_tag",
  value1Title: "about_text_value_1_title",
  value1Body: "about_text_value_1_body",
  value2Tag: "about_text_value_2_tag",
  value2Title: "about_text_value_2_title",
  value2Body: "about_text_value_2_body",
  value3Tag: "about_text_value_3_tag",
  value3Title: "about_text_value_3_title",
  value3Body: "about_text_value_3_body",
  ctaTitle: "about_text_cta_title",
  ctaBody: "about_text_cta_body",
  ctaPrimaryLabel: "about_text_cta_primary_label",
  ctaSecondaryLabel: "about_text_cta_secondary_label",
};

const ABOUT_TEXT_DEFAULTS = {
  introImageUrl: "/images/Mango,Grape,tropical flavours with desription.jpeg",
  introKicker: "Who We Are",
  introTitle: "About Club Zero",
  introLead:
    "Club Zero was born from a simple idea: everyone deserves to enjoy the feeling of something premium.",
  introBody:
    "In today's economic climate, everyday luxuries are becoming harder to afford. The small moments that once felt easy - treating yourself, enjoying something refreshing, indulging in quality - are now often out of reach for many South Africans. We saw that gap, and we knew there had to be a better way. That's where Club Zero began.",
  introChip1: "0g Added Sugar",
  introChip2: "Big Flavor",
  introChip3: "Everyday Energy",
  storyTitle: "Where Club Zero Began",
  storyBody1:
    "Our vision was to create a product that delivers a premium experience without the premium price tag. By manufacturing locally, we're able to keep costs down while maintaining high standards - making it possible for more people to enjoy a drink that feels special, refreshing, and worth it.",
  storyBody2:
    "But Club Zero is more than just a product - it's a family business built on passion, resilience, and a deep belief in what South Africa is capable of. Every bottle reflects our commitment to quality, community, and creating something we can be proud of.",
  missionTitle: "Our Mission",
  missionBody:
    "To deliver a premium refreshment experience at an accessible price by producing locally, protecting quality, and making everyday enjoyment possible for more South Africans.",
  visionTitle: "Our Vision",
  visionBody:
    "We are proudly South African. From the way we make our drinks to the people we make them for, everything we do is rooted in bringing a little more enjoyment, accessibility, and pride into everyday life.",
  promiseKicker: "Product Promise",
  promiseTitle: "What you can always expect",
  promiseCard1Icon: "0g",
  promiseCard1Title: "Premium Taste, Every Time",
  promiseCard1Body:
    "You can always expect a crisp, refreshing flavour that tastes premium, without compromise.",
  promiseCard2Icon: "Low",
  promiseCard2Title: "Quality You Can Trust",
  promiseCard2Body:
    "Made with care and consistency, every bottle delivers reliable quality you can count on.",
  promiseCard3Icon: "Bold",
  promiseCard3Title: "Refreshment Without the Trade-Off",
  promiseCard3Body:
    "Enjoy a drink that feels like a treat - without the premium price tag.",
  valuesTitle: "Our Core Values",
  valuesSubtitle:
    "The standards we use to build every product and experience.",
  value1Tag: "01",
  value1Title: "Accessibility",
  value1Body:
    "We believe everyone deserves access to premium experiences - without paying a premium price.",
  value2Tag: "02",
  value2Title: "Quality",
  value2Body:
    "We are committed to delivering consistent, high-quality products that never compromise on taste or experience.",
  value3Tag: "03",
  value3Title: "Proudly South African",
  value3Body:
    "We champion local manufacturing, local talent, and the spirit of South Africa in everything we do.",
  ctaTitle: "Ready to Explore Club Zero?",
  ctaBody:
    "Browse our latest products and find your next favorite low-sugar refreshment.",
  ctaPrimaryLabel: "View Products",
  ctaSecondaryLabel: "Become an Affiliate",
};

const buildAboutTextSettings = (settingsByKey = {}) => {
  const hasKey = (key) =>
    Object.prototype.hasOwnProperty.call(settingsByKey, key);
  const readString = (key, fallback) =>
    hasKey(key) ? String(settingsByKey[key] ?? "") : fallback;

  return Object.entries(ABOUT_TEXT_SETTING_KEYS).reduce((acc, [field, key]) => {
    acc[field] = readString(key, ABOUT_TEXT_DEFAULTS[field] || "");
    return acc;
  }, {});
};

const getAboutTextSettings = async () => {
  try {
    const settings = await prisma.appSetting.findMany({
      where: { key: { in: Object.values(ABOUT_TEXT_SETTING_KEYS) } },
      select: { key: true, value: true },
    });

    const settingsByKey = settings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {});

    return buildAboutTextSettings(settingsByKey);
  } catch (error) {
    logger.warn("about_text_settings_load_failed", { error: error.message });
    return buildAboutTextSettings({});
  }
};

const saveAboutTextSettings = async (settings = {}) => {
  const payload = Object.entries(ABOUT_TEXT_SETTING_KEYS).reduce((acc, [field, key]) => {
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

  return prisma.$transaction(writes);
};

module.exports = {
  ABOUT_TEXT_DEFAULTS,
  ABOUT_TEXT_SETTING_KEYS,
  getAboutTextSettings,
  saveAboutTextSettings,
};
