const { saveHomeHeroSettings, getHomeHeroSettings } = require("../lib/homeHeroSettings");

const HERO_LIMITS = {
  imageUrl: 300,
};

const enforceMaxLength = (value, max, label) => {
  if (value.length > max) {
    return `${label} must be ${max} characters or fewer.`;
  }
  return null;
};

const parseHeroInput = (body, file, current = {}) => {
  const imageUrlInput = (body.heroImageUrl || "").toString().trim();
  const removeImage = body.heroImageRemove === "on";
  const imageUrl = file
    ? `/uploads/${file.filename}`
    : removeImage
      ? ""
      : imageUrlInput || current.imageUrl || "";

  const lengthChecks = [
    enforceMaxLength(imageUrl, HERO_LIMITS.imageUrl, "Image URL"),
  ];

  const lengthError = lengthChecks.find(Boolean);
  if (lengthError) {
    return { error: lengthError };
  }

  return {
    data: {
      imageUrl,
    },
  };
};

exports.getAdminHomeHero = async (req, res) => {
  const hero = await getHomeHeroSettings();

  return res.render("admin-home-hero", {
    hero,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminHomeHero = async (req, res) => {
  const current = await getHomeHeroSettings();
  const parsed = parseHeroInput(req.body, req.file, current);

  if (parsed.error) {
    return res.redirect(
      `/admin/home-hero?error=${encodeURIComponent(parsed.error)}`,
    );
  }

  await saveHomeHeroSettings({
    ...current,
    ...parsed.data,
  });
  return res.redirect("/admin/home-hero?success=Homepage+hero+updated");
};
