const {
  ABOUT_TEXT_DEFAULTS,
  getAboutTextSettings,
  saveAboutTextSettings,
} = require("../lib/aboutTextSettings");

const trimText = (value) => (value || "").toString().trim();
const applyLengthLimit = (value, maxLength = 600) => value.slice(0, maxLength);

exports.getAboutPage = async (_req, res) => {
  const aboutText = await getAboutTextSettings();
  return res.render("about", { aboutText });
};

exports.getAdminAboutContent = async (req, res) => {
  const content = await getAboutTextSettings();
  return res.render("admin-about-content", {
    content,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminAboutContent = async (req, res) => {
  const existing = await getAboutTextSettings();
  const next = Object.keys(ABOUT_TEXT_DEFAULTS).reduce((acc, field) => {
    const incoming =
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? trimText(req.body[field])
        : existing[field];
    acc[field] = applyLengthLimit(incoming, 600);
    return acc;
  }, {});

  await saveAboutTextSettings(next);
  return res.redirect("/admin/about-content?success=About+page+text+updated");
};
