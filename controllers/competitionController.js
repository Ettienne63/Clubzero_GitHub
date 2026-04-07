const {
  COMPETITION_CONTENT_DEFAULTS,
  getCompetitionContentSettings,
  saveCompetitionContentSettings,
} = require("../lib/competitionContentSettings");
const {
  getCompetitionEntryRules,
  saveCompetitionEntryRules,
} = require("../lib/competitionEntryRules");
const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("../lib/logger");
const {
  stashAdminFormState,
  consumeAdminFormState,
} = require("../lib/adminFormState");

const COMPETITION_CONTENT_DRAFT_KEY = "competition_content_form";

const trimText = (value) => (value || "").toString().trim();
const applyLengthLimit = (value, maxLength = 1200) => value.slice(0, maxLength);
const parseSwitchOn = (rawValue) =>
  Array.isArray(rawValue)
    ? rawValue.some((value) => String(value || "").trim().toLowerCase() === "on")
    : String(rawValue || "").trim().toLowerCase() === "on";
const parseCompetitionPageEnabled = (body, fallbackEnabled = true) => {
  if (Object.prototype.hasOwnProperty.call(body || {}, "competitionPageEnabled")) {
    return parseSwitchOn(body.competitionPageEnabled);
  }
  if (Object.prototype.hasOwnProperty.call(body || {}, "hideCompetitionsPage")) {
    return !parseSwitchOn(body.hideCompetitionsPage);
  }
  return Boolean(fallbackEnabled);
};
const splitLines = (value) =>
  String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const getFieldLengthLimit = (field) => {
  if (field === "heroCtaUrl") return 2048;
  if (field === "heroImageUrl") return 2048;
  if (field === "endsAtIso") return 64;
  if (field === "entryRulesText" || field === "termsText") return 4000;
  return 1200;
};

const calculateEntriesForOrder = (order, rules) => {
  const subtotal = Number(order?.productsSubtotal ?? order?.total ?? 0);
  let entries = 0;

  if (subtotal >= rules.tierTwoMinSubtotal) {
    entries = rules.tierTwoEntries;
  } else if (subtotal >= rules.tierOneMinSubtotal) {
    entries = rules.tierOneEntries;
  }

  if (
    entries > 0 &&
    String(order?.affiliateReferrerCode || "").trim()
  ) {
    entries += rules.affiliateBonusEntries;
  }

  return entries;
};

const formatCurrencyCompact = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return "0";
  const rounded = Number(amount.toFixed(2));
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return rounded.toFixed(2);
};

const pluralizeEntryWord = (count) => (Number(count) === 1 ? "entry" : "entries");

const buildEntryRulesTextFromRules = (rules) => {
  return [
    `Buy any Club Zero order over R${formatCurrencyCompact(rules.tierOneMinSubtotal)} = ${rules.tierOneEntries} ${pluralizeEntryWord(rules.tierOneEntries)}`,
    `Buy any Club Zero order over R${formatCurrencyCompact(rules.tierTwoMinSubtotal)} = ${rules.tierTwoEntries} ${pluralizeEntryWord(rules.tierTwoEntries)}`,
    `Use an approved affiliate code at checkout = +${rules.affiliateBonusEntries} bonus ${pluralizeEntryWord(rules.affiliateBonusEntries)}`,
  ].join("\n");
};

const resolveHeroImageUrl = (body, file, existingImageUrl) => {
  const removeImage = body.heroImageRemove === "on";
  const imageUrlInput = trimText(body.heroImageUrl);

  if (file) {
    return `/uploads/${file.filename}`;
  }

  if (removeImage) {
    return "";
  }

  return imageUrlInput || existingImageUrl || "";
};

const buildPublicPageModel = (content) => {
  const legacyHeroTitle = "Enter This Month's Competition";
  const legacyHeroSubtitle =
    "Buy, enter, and stand a chance to win exclusive Club Zero prizes.";
  const heroTitle =
    trimText(content.heroTitle) === legacyHeroTitle
      ? "Win Big With Club Zero"
      : content.heroTitle;
  const heroSubtitle =
    trimText(content.heroSubtitle) === legacyHeroSubtitle
      ? "Place your order, get entered automatically, and stand a chance to win this month's prize."
      : content.heroSubtitle;
  const heroCtaLabel =
    trimText(content.heroCtaLabel) === "Enter Now"
      ? "Shop & Enter"
      : content.heroCtaLabel;

  const entryRules = splitLines(content.entryRulesText);
  const terms = splitLines(content.termsText);

  const pastWinners = [1, 2, 3]
    .map((index) => ({
      name: trimText(content[`winner${index}Name`]),
      city: trimText(content[`winner${index}City`]),
      wonAt: trimText(content[`winner${index}WonAt`]),
      prize: trimText(content[`winner${index}Prize`]),
    }))
    .filter((winner) => winner.name && winner.prize);

  const faqs = [1, 2, 3]
    .map((index) => ({
      question: trimText(content[`faq${index}Question`]),
      answer: trimText(content[`faq${index}Answer`]),
    }))
    .filter((faq) => faq.question && faq.answer);

  return {
    hero: {
      badge: content.heroBadge,
      title: heroTitle,
      subtitle: heroSubtitle,
      imageUrl: content.heroImageUrl,
      ctaLabel: heroCtaLabel,
      ctaUrl: content.heroCtaUrl || "/auth/products",
    },
    currentCompetition: {
      title: content.currentTitle,
      prize: content.prize,
      deadlineLabel: content.deadlineLabel,
      endsAtIso: content.endsAtIso,
      winnerDateLabel: content.winnerDateLabel,
      eligibility: content.eligibility,
      entryRules,
    },
    pastWinners,
    faqs,
    terms,
  };
};

exports.getCompetitionsPage = async (_req, res) => {
  const [content, loadedRules] = await Promise.all([
    getCompetitionContentSettings(),
    getCompetitionEntryRules(),
  ]);
  let rules = loadedRules;
  if (rules.hideCompetitionsPage) {
    return res.status(404).render("competition-hidden");
  }
  const contentWithRuleText = {
    ...content,
    entryRulesText: buildEntryRulesTextFromRules(rules),
  };
  const pageModel = buildPublicPageModel(contentWithRuleText);
  const competitionEndsAt = new Date(pageModel.currentCompetition.endsAtIso);
  const hasValidEndAt = !Number.isNaN(competitionEndsAt.getTime());
  const isCompetitionExpired = hasValidEndAt && Date.now() > competitionEndsAt.getTime();

  // Auto-enable "Coming Soon" when the current competition has ended.
  if (isCompetitionExpired && !rules.comingSoonEnabled) {
    try {
      rules = await saveCompetitionEntryRules({
        ...rules,
        comingSoonEnabled: true,
      });
    } catch (error) {
      logger.warn("competition_auto_toggle_coming_soon_failed", {
        error: error.message,
      });
    }
  }
  const userId = Number.parseInt(res.locals.user?.id, 10);

  let entryCounter = {
    totalEntries: 0,
    qualifyingOrders: 0,
    isLoggedIn: Number.isInteger(userId),
  };

  if (!rules.comingSoonEnabled && Number.isInteger(userId)) {
    const paidOrders = await prisma.order.findMany({
      where: {
        userId,
        status: "PAID",
        ...(hasValidEndAt ? { createdAt: { lte: competitionEndsAt } } : {}),
      },
      select: {
        productsSubtotal: true,
        total: true,
        affiliateReferrerCode: true,
        createdAt: true,
      },
    });

    const totalEntries = paidOrders.reduce((sum, order) => {
      return sum + calculateEntriesForOrder(order, rules);
    }, 0);
    const qualifyingOrders = paidOrders.reduce((sum, order) => {
      return sum + (calculateEntriesForOrder(order, rules) > 0 ? 1 : 0);
    }, 0);

    entryCounter = {
      totalEntries,
      qualifyingOrders,
      isLoggedIn: true,
    };
  } else if (Number.isInteger(userId)) {
    entryCounter = {
      totalEntries: 0,
      qualifyingOrders: 0,
      isLoggedIn: true,
    };
  }

  return res.render("competitions", {
    ...pageModel,
    entryCounter,
    competitionRules: rules,
  });
};

exports.getAdminCompetitionRulesPage = async (req, res) => {
  const rules = await getCompetitionEntryRules();
  return res.render("admin-competition-rules", {
    success: req.query.success || null,
    error: req.query.error || null,
    formData: rules,
  });
};

exports.updateAdminCompetitionRules = async (req, res) => {
  const rawComingSoonValue = req.body?.comingSoonEnabled;
  const comingSoonEnabled = parseSwitchOn(rawComingSoonValue);
  const competitionPageEnabled = parseCompetitionPageEnabled(req.body, true);
  const hideCompetitionsPage = !competitionPageEnabled;
  const tierOneMinSubtotal = Number.parseFloat(
    (req.body?.tierOneMinSubtotal || "").toString().trim(),
  );
  const tierOneEntries = Number.parseInt(
    (req.body?.tierOneEntries || "").toString().trim(),
    10,
  );
  const tierTwoMinSubtotal = Number.parseFloat(
    (req.body?.tierTwoMinSubtotal || "").toString().trim(),
  );
  const tierTwoEntries = Number.parseInt(
    (req.body?.tierTwoEntries || "").toString().trim(),
    10,
  );
  const affiliateBonusEntries = Number.parseInt(
    (req.body?.affiliateBonusEntries || "").toString().trim(),
    10,
  );

  if (!Number.isFinite(tierOneMinSubtotal) || tierOneMinSubtotal < 0) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Please enter a valid Tier 1 minimum subtotal.",
      )}`,
    );
  }
  if (!Number.isFinite(tierTwoMinSubtotal) || tierTwoMinSubtotal < 0) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Please enter a valid Tier 2 minimum subtotal.",
      )}`,
    );
  }
  if (tierTwoMinSubtotal < tierOneMinSubtotal) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Tier 2 minimum subtotal must be greater than or equal to Tier 1 minimum subtotal.",
      )}`,
    );
  }
  if (!Number.isInteger(tierOneEntries) || tierOneEntries < 0) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Please enter a valid Tier 1 entry count.",
      )}`,
    );
  }
  if (!Number.isInteger(tierTwoEntries) || tierTwoEntries < 0) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Please enter a valid Tier 2 entry count.",
      )}`,
    );
  }
  if (!Number.isInteger(affiliateBonusEntries) || affiliateBonusEntries < 0) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        "Please enter a valid affiliate bonus entry count.",
      )}`,
    );
  }

  try {
    await saveCompetitionEntryRules({
      comingSoonEnabled,
      hideCompetitionsPage,
      tierOneMinSubtotal,
      tierOneEntries,
      tierTwoMinSubtotal,
      tierTwoEntries,
      affiliateBonusEntries,
    });
    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(
        "Competition entry rules updated.",
      )}`,
    );
  } catch (error) {
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        error.message || "Unable to save competition entry rules.",
      )}`,
    );
  }
};

exports.toggleAdminCompetitionComingSoon = async (req, res) => {
  const rawComingSoonValue = req.body?.comingSoonEnabled;
  const comingSoonEnabled = parseSwitchOn(rawComingSoonValue);

  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  try {
    const current = await getCompetitionEntryRules();
    const next = await saveCompetitionEntryRules({
      ...current,
      comingSoonEnabled,
    });

    if (wantsJson) {
      return res.json({
        success: true,
        comingSoonEnabled: Boolean(next.comingSoonEnabled),
        message: `Competitions Coming Soon is now ${next.comingSoonEnabled ? "enabled" : "disabled"}.`,
      });
    }

    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(
        `Competitions Coming Soon is now ${next.comingSoonEnabled ? "enabled" : "disabled"}.`,
      )}`,
    );
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: error.message || "Unable to update competitions coming soon toggle.",
      });
    }

    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        error.message || "Unable to update competitions coming soon toggle.",
      )}`,
    );
  }
};

exports.toggleAdminCompetitionPageVisibility = async (req, res) => {
  const competitionPageEnabled = parseCompetitionPageEnabled(req.body, true);
  const hideCompetitionsPage = !competitionPageEnabled;

  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  try {
    const current = await getCompetitionEntryRules();
    const next = await saveCompetitionEntryRules({
      ...current,
      hideCompetitionsPage,
    });

    if (wantsJson) {
      return res.json({
        success: true,
        hideCompetitionsPage: Boolean(next.hideCompetitionsPage),
        competitionPageEnabled: !Boolean(next.hideCompetitionsPage),
        message: `Competition page is now ${next.hideCompetitionsPage ? "hidden" : "visible"}.`,
      });
    }

    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(
        `Competition page is now ${next.hideCompetitionsPage ? "hidden" : "visible"}.`,
      )}`,
    );
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: error.message || "Unable to update competition page visibility.",
      });
    }

    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        error.message || "Unable to update competition page visibility.",
      )}`,
    );
  }
};

exports.getAdminCompetitionContent = async (req, res) => {
  const [content, rules] = await Promise.all([
    getCompetitionContentSettings(),
    getCompetitionEntryRules(),
  ]);
  const contentWithRuleText = {
    ...content,
    entryRulesText: buildEntryRulesTextFromRules(rules),
  };
  const draft = consumeAdminFormState(req, COMPETITION_CONTENT_DRAFT_KEY);
  const mergedContent = { ...contentWithRuleText };

  if (draft) {
    Object.keys(COMPETITION_CONTENT_DEFAULTS).forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(draft, field)) {
        return;
      }
      mergedContent[field] = applyLengthLimit(
        trimText(draft[field]),
        getFieldLengthLimit(field),
      );
    });

    if (String(draft.heroImageRemove || "").toLowerCase() === "on") {
      mergedContent.heroImageUrl = "";
    }
  }

  // Always mirror management rules in Edit Comp view.
  mergedContent.entryRulesText = buildEntryRulesTextFromRules(rules);

  return res.render("admin-competition-content", {
    content: mergedContent,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateAdminCompetitionContent = async (req, res) => {
  try {
    const [existing, rules] = await Promise.all([
      getCompetitionContentSettings(),
      getCompetitionEntryRules(),
    ]);
    const next = Object.keys(COMPETITION_CONTENT_DEFAULTS).reduce(
      (acc, field) => {
        const incoming =
          Object.prototype.hasOwnProperty.call(req.body, field)
            ? trimText(req.body[field])
            : existing[field];
        acc[field] = applyLengthLimit(incoming, getFieldLengthLimit(field));
        return acc;
      },
      {},
    );

    next.heroImageUrl = applyLengthLimit(
      resolveHeroImageUrl(req.body, req.file, existing.heroImageUrl),
      getFieldLengthLimit("heroImageUrl"),
    );
    // Keep entry rules fully managed from /admin/competition-rules.
    next.entryRulesText = buildEntryRulesTextFromRules(rules);

    await saveCompetitionContentSettings(next);
    return res.redirect(
      "/admin/competitions-content?success=Competition+content+updated",
    );
  } catch (error) {
    logger.error("admin_competition_content_update_failed", {
      error: error.message,
    });
    stashAdminFormState(req, COMPETITION_CONTENT_DRAFT_KEY, req.body || {});
    return res.redirect(
      `/admin/competitions-content?error=${encodeURIComponent(
        "We couldn't save competition content right now. Your inputs are still loaded below.",
      )}`,
    );
  }
};
