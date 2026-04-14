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

const readSingleValue = (value) =>
  Array.isArray(value) ? value[value.length - 1] : value;
const trimText = (value) => (readSingleValue(value) || "").toString().trim();
const applyLengthLimit = (value, maxLength = 600) => value.slice(0, maxLength);
const getFieldLengthLimit = (field) =>
  field.endsWith("ImageUrl") ? 2048 : 600;
const normalizeToggle = (value, fallback = "off") => {
  const values = (Array.isArray(value) ? value : [value]).map((item) =>
    String(item || "")
      .trim()
      .toLowerCase(),
  );

  if (values.some((item) => ["on", "true", "1", "yes"].includes(item))) {
    return "on";
  }

  if (values.some((item) => ["off", "false", "0", "no"].includes(item))) {
    return "off";
  }

  return fallback;
};
const normalizeFieldValue = (field, value, fallback = "") => {
  if (field === "teamSectionEnabled") {
    return normalizeToggle(value, fallback || "on");
  }

  return applyLengthLimit(trimText(value), getFieldLengthLimit(field));
};
const getUploadedFile = (files, fieldName) => {
  const entries = files && files[fieldName];
  if (!Array.isArray(entries) || !entries.length) {
    return null;
  }
  return entries[0];
};
const resolveIntroImageUrl = (body, files, existingImageUrl) => {
  const removeImage = body.introImageRemove === "on";
  const imageUrlInput = trimText(body.introImageUrl);
  const file = getUploadedFile(files, "aboutIntroImage");

  if (file) {
    return `/uploads/${file.filename}`;
  }

  if (removeImage) {
    return "";
  }

  return imageUrlInput || existingImageUrl || "";
};
const resolveTeamMemberImageUrl = (body, files, memberNumber, existingImageUrl) => {
  const removeKey = `teamMember${memberNumber}ImageRemove`;
  const fileFieldName = `teamMember${memberNumber}Image`;
  const removeImage = body[removeKey] === "on";
  const file = getUploadedFile(files, fileFieldName);

  if (file) {
    return `/uploads/${file.filename}`;
  }

  if (removeImage) {
    return "";
  }

  return existingImageUrl || "";
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
      mergedContent[field] = normalizeFieldValue(
        field,
        draft[field],
        mergedContent[field],
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
          ? req.body[field]
          : existing[field];
      acc[field] = normalizeFieldValue(field, incoming, existing[field]);
      return acc;
    }, {});
    next.teamSectionEnabled = normalizeToggle(req.body.teamSectionEnabled, "off");

    next.introImageUrl = applyLengthLimit(
      resolveIntroImageUrl(req.body, req.files, existing.introImageUrl),
      getFieldLengthLimit("introImageUrl"),
    );
    [1, 2, 3, 4].forEach((memberNumber) => {
      const field = `teamMember${memberNumber}ImageUrl`;
      next[field] = applyLengthLimit(
        resolveTeamMemberImageUrl(req.body, req.files, memberNumber, existing[field]),
        getFieldLengthLimit(field),
      );
    });

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
