const {
  ABOUT_TEXT_DEFAULTS,
  getAboutTextSettings,
  saveAboutTextSettings,
} = require("../lib/aboutTextSettings");
const { logger } = require("../lib/logger");
const {
  stashAdminFormState,
  consumeAdminFormState,
} = require("../lib/adminFormState");

const ABOUT_CONTENT_DRAFT_KEY = "about_content_form";

const trimText = (value) => (value || "").toString().trim();
const applyLengthLimit = (value, maxLength = 600) => value.slice(0, maxLength);
const getFieldLengthLimit = (field) =>
  field === "introImageUrl" ? 2048 : 600;
const resolveIntroImageUrl = (body, file, existingImageUrl) => {
  const removeImage = body.introImageRemove === "on";
  const imageUrlInput = trimText(body.introImageUrl);

  if (file) {
    return `/uploads/${file.filename}`;
  }

  if (removeImage) {
    return "";
  }

  return imageUrlInput || existingImageUrl || "";
};

exports.getAboutPage = async (_req, res) => {
  const aboutText = await getAboutTextSettings();
  return res.render("about", { aboutText });
};

exports.getAdminAboutContent = async (req, res) => {
  const content = await getAboutTextSettings();
  const draft = consumeAdminFormState(req, ABOUT_CONTENT_DRAFT_KEY);
  const mergedContent = { ...content };

  if (draft) {
    Object.keys(ABOUT_TEXT_DEFAULTS).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(draft, field)) {
        return;
      }
      mergedContent[field] = applyLengthLimit(
        trimText(draft[field]),
        getFieldLengthLimit(field),
      );
    });

    if (String(draft.introImageRemove || "").toLowerCase() === "on") {
      mergedContent.introImageUrl = "";
    }
  }

  return res.render("admin-about-content", {
    content: mergedContent,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminAboutContent = async (req, res) => {
  try {
    const existing = await getAboutTextSettings();
    const next = Object.keys(ABOUT_TEXT_DEFAULTS).reduce((acc, field) => {
      const incoming =
        Object.prototype.hasOwnProperty.call(req.body, field)
          ? trimText(req.body[field])
          : existing[field];
      acc[field] = applyLengthLimit(incoming, getFieldLengthLimit(field));
      return acc;
    }, {});

    next.introImageUrl = applyLengthLimit(
      resolveIntroImageUrl(req.body, req.file, existing.introImageUrl),
      getFieldLengthLimit("introImageUrl"),
    );

    await saveAboutTextSettings(next);
    return res.redirect("/admin/about-content?success=About+page+text+updated");
  } catch (error) {
    logger.error("admin_about_content_update_failed", { error: error.message });
    stashAdminFormState(req, ABOUT_CONTENT_DRAFT_KEY, req.body || {});
    return res.redirect(
      `/admin/about-content?error=${encodeURIComponent(
        "We couldn't save About content right now. Your inputs are still loaded below.",
      )}`,
    );
  }
};
