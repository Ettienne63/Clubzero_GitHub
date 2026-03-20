const {
  THEME_OPTIONS,
  DEFAULT_THEME_ID,
  isValidTheme,
  getSiteTheme,
  saveSiteTheme,
} = require("../lib/themeSettings");

exports.getAdminThemePage = async (req, res) => {
  const currentTheme = await getSiteTheme();
  return res.render("admin-theme", {
    currentTheme,
    themeOptions: THEME_OPTIONS,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminTheme = async (req, res) => {
  const nextTheme = (req.body.theme || "").toString().trim().toLowerCase();
  if (!isValidTheme(nextTheme)) {
    return res.redirect(
      `/admin/theme?error=${encodeURIComponent("Please choose a valid color scheme.")}`,
    );
  }

  const savedTheme = await saveSiteTheme(nextTheme);
  const selected = THEME_OPTIONS.find((theme) => theme.id === savedTheme);
  const selectedLabel = selected?.name || DEFAULT_THEME_ID;

  return res.redirect(
    `/admin/theme?success=${encodeURIComponent(`Color scheme changed to ${selectedLabel}.`)}`,
  );
};
