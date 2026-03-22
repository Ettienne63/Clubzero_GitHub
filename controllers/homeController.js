const {
  HERO_DEFAULTS,
  saveHomeHeroSettings,
  getHomeHeroSettings,
} = require("../lib/homeHeroSettings");
const {
  HOME_TEXT_DEFAULTS,
  getHomeTextSettings,
  saveHomeTextSettings,
} = require("../lib/homeTextSettings");

const HERO_LIMITS = {
  logoUrl: 300,
  badge: 80,
  title: 140,
  subtitle: 240,
  chipOne: 80,
  chipTwo: 80,
  chipThree: 80,
  primaryLabel: 60,
  primaryUrl: 260,
  secondaryLabel: 60,
  secondaryUrl: 260,
  imageUrl: 300,
};

const enforceMaxLength = (value, max, label) => {
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer.`;
  }
  return null;
};

const parseHeroInput = (body, files, current = {}) => {
  const heroImageFile = files?.heroImage?.[0] || null;
  const heroLogoFile = files?.heroLogo?.[0] || null;
  const logoUrlInput = (body.heroLogoUrl || "").toString().trim();
  const removeLogo = body.heroLogoRemove === "on";
  const badge = (body.badge || "").toString().trim();
  const title = (body.title || "").toString().trim();
  const subtitle = (body.subtitle || "").toString().trim();
  const chipOne = (body.chipOne || "").toString().trim();
  const chipTwo = (body.chipTwo || "").toString().trim();
  const chipThree = (body.chipThree || "").toString().trim();
  const primaryLabel = (body.primaryLabel || "").toString().trim();
  const primaryUrl = (body.primaryUrl || "").toString().trim();
  const secondaryLabel = (body.secondaryLabel || "").toString().trim();
  const secondaryUrl = (body.secondaryUrl || "").toString().trim();
  const imageUrlInput = (body.heroImageUrl || "").toString().trim();
  const removeImage = body.heroImageRemove === "on";
  const imageUrl = heroImageFile
    ? `/uploads/${heroImageFile.filename}`
    : removeImage
      ? ""
      : imageUrlInput || current.imageUrl || "";
  const logoUrl = heroLogoFile
    ? `/uploads/${heroLogoFile.filename}`
    : removeLogo
      ? ""
      : logoUrlInput || current.logoUrl || "";

  const lengthChecks = [
    enforceMaxLength(logoUrl, HERO_LIMITS.logoUrl, "Logo URL"),
    enforceMaxLength(badge, HERO_LIMITS.badge, "Badge"),
    enforceMaxLength(title, HERO_LIMITS.title, "Title"),
    enforceMaxLength(subtitle, HERO_LIMITS.subtitle, "Subtitle"),
    enforceMaxLength(chipOne, HERO_LIMITS.chipOne, "Chip 1"),
    enforceMaxLength(chipTwo, HERO_LIMITS.chipTwo, "Chip 2"),
    enforceMaxLength(chipThree, HERO_LIMITS.chipThree, "Chip 3"),
    enforceMaxLength(primaryLabel, HERO_LIMITS.primaryLabel, "Primary button label"),
    enforceMaxLength(primaryUrl, HERO_LIMITS.primaryUrl, "Primary button URL"),
    enforceMaxLength(secondaryLabel, HERO_LIMITS.secondaryLabel, "Secondary button label"),
    enforceMaxLength(secondaryUrl, HERO_LIMITS.secondaryUrl, "Secondary button URL"),
    enforceMaxLength(imageUrl, HERO_LIMITS.imageUrl, "Image URL"),
  ];

  const lengthError = lengthChecks.find(Boolean);
  if (lengthError) {
    return { error: lengthError };
  }

  return {
    data: {
      badge: badge || current.badge || HERO_DEFAULTS.badge,
      title: title || current.title || HERO_DEFAULTS.title,
      subtitle: subtitle || current.subtitle || HERO_DEFAULTS.subtitle,
      chipOne: chipOne || current.chipOne || HERO_DEFAULTS.chipOne,
      chipTwo: chipTwo || current.chipTwo || HERO_DEFAULTS.chipTwo,
      chipThree: chipThree || current.chipThree || HERO_DEFAULTS.chipThree,
      primaryLabel:
        primaryLabel || current.primaryLabel || HERO_DEFAULTS.primaryLabel,
      primaryUrl: primaryUrl || current.primaryUrl || HERO_DEFAULTS.primaryUrl,
      secondaryLabel:
        secondaryLabel || current.secondaryLabel || HERO_DEFAULTS.secondaryLabel,
      secondaryUrl:
        secondaryUrl || current.secondaryUrl || HERO_DEFAULTS.secondaryUrl,
      logoUrl,
      imageUrl,
    },
  };
};

exports.getAdminHomeHero = async (req, res) => {
  return res.redirect("/admin/home-content");
};

exports.updateAdminHomeHero = async (req, res) => {
  return res.redirect("/admin/home-content");
};

const trimText = (value) => (value || "").toString().trim();

const applyLengthLimit = (value, maxLength = 600) => value.slice(0, maxLength);

exports.getAdminHomeContent = async (req, res) => {
  const [content, hero] = await Promise.all([
    getHomeTextSettings(),
    getHomeHeroSettings(),
  ]);
  return res.render("admin-home-content", {
    content,
    hero,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.getAdminNavEdit = async (req, res) => {
  const hero = await getHomeHeroSettings();
  return res.render("admin-nav-edit", {
    hero,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminNavEdit = async (req, res) => {
  const existingHero = await getHomeHeroSettings();
  const logoUrlInput = (req.body.heroLogoUrl || "").toString().trim();
  const removeLogo = req.body.heroLogoRemove === "on";
  const uploadedLogo = req.file ? `/uploads/${req.file.filename}` : "";
  const logoUrl = uploadedLogo
    ? uploadedLogo
    : removeLogo
      ? ""
      : logoUrlInput || existingHero.logoUrl || "";

  const logoLengthError = enforceMaxLength(
    logoUrl,
    HERO_LIMITS.logoUrl,
    "Logo URL",
  );
  if (logoLengthError) {
    return res.redirect(
      `/admin/nav-edit?error=${encodeURIComponent(logoLengthError)}`,
    );
  }

  await saveHomeHeroSettings({
    ...existingHero,
    logoUrl,
  });

  return res.redirect("/admin/nav-edit?success=Navbar+logo+updated");
};

exports.updateAdminHomeContent = async (req, res) => {
  const [existing, existingHero] = await Promise.all([
    getHomeTextSettings(),
    getHomeHeroSettings(),
  ]);
  const parsedHero = parseHeroInput(req.body, req.files || {}, existingHero);
  if (parsedHero.error) {
    return res.redirect(
      `/admin/home-content?error=${encodeURIComponent(parsedHero.error)}`,
    );
  }

  const next = Object.keys(HOME_TEXT_DEFAULTS).reduce((acc, field) => {
    const incoming =
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? trimText(req.body[field])
        : existing[field];
    acc[field] = applyLengthLimit(incoming, 600);
    return acc;
  }, {});

  await Promise.all([
    saveHomeTextSettings(next),
    saveHomeHeroSettings({
      ...existingHero,
      ...parsedHero.data,
    }),
  ]);

  return res.redirect("/admin/home-content?success=Homepage+content+updated");
};
