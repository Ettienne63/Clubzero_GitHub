const MAX_FIELDS = 250;
const MAX_VALUE_LENGTH = 2000;
const SESSION_KEY = "adminFormDrafts";

const sanitizeDraft = (data = {}) => {
  const sanitized = {};
  const entries = Object.entries(data).slice(0, MAX_FIELDS);

  entries.forEach(([key, value]) => {
    if (!key) return;
    if (Array.isArray(value)) {
      const first = value[0];
      sanitized[key] = String(first ?? "").slice(0, MAX_VALUE_LENGTH);
      return;
    }
    if (value === null || typeof value === "undefined") {
      sanitized[key] = "";
      return;
    }
    sanitized[key] = String(value).slice(0, MAX_VALUE_LENGTH);
  });

  return sanitized;
};

const stashAdminFormState = (req, formKey, data = {}) => {
  if (!req?.session || !formKey) return;
  const existing =
    req.session[SESSION_KEY] && typeof req.session[SESSION_KEY] === "object"
      ? req.session[SESSION_KEY]
      : {};
  existing[formKey] = sanitizeDraft(data);
  req.session[SESSION_KEY] = existing;
};

const consumeAdminFormState = (req, formKey) => {
  if (!req?.session || !formKey) return null;
  const drafts = req.session[SESSION_KEY];
  if (!drafts || typeof drafts !== "object") return null;
  const draft = drafts[formKey] || null;
  if (!draft) return null;
  delete drafts[formKey];
  req.session[SESSION_KEY] = drafts;
  return draft;
};

module.exports = {
  stashAdminFormState,
  consumeAdminFormState,
};
