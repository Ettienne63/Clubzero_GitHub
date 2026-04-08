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
const { randomInt } = require("crypto");

const SAST_OFFSET_MINUTES = 2 * 60;
const SAST_OFFSET_MS = SAST_OFFSET_MINUTES * 60 * 1000;
const RECENT_COMPETITION_WINNERS_KEY = "competition_recent_winners";
const RECENT_COMPETITION_WINNERS_LIMIT = 25;

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
const formatDateInput = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
};
const formatDateTimeDisplay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const readable = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${readable} SAST`;
};
const resolveDeadlineLabel = (endsAtIso, fallbackLabel = "") => {
  const formatted = formatDateTimeDisplay(endsAtIso);
  return formatted || trimText(fallbackLabel);
};
const formatSastDateTimeLocalValue = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  const year = sast.getUTCFullYear();
  const month = String(sast.getUTCMonth() + 1).padStart(2, "0");
  const day = String(sast.getUTCDate()).padStart(2, "0");
  const hours = String(sast.getUTCHours()).padStart(2, "0");
  const minutes = String(sast.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
const getStartOfTodayLocal = () => {
  const now = new Date();
  const sastNow = new Date(now.getTime() + SAST_OFFSET_MS);
  const year = sastNow.getUTCFullYear();
  const month = sastNow.getUTCMonth();
  const day = sastNow.getUTCDate();
  const utcMsAtSastMidnight = Date.UTC(year, month, day, 0, 0, 0) - SAST_OFFSET_MS;
  return new Date(utcMsAtSastMidnight);
};
const formatSastIso = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sast = new Date(date.getTime() + SAST_OFFSET_MS);
  const year = sast.getUTCFullYear();
  const month = String(sast.getUTCMonth() + 1).padStart(2, "0");
  const day = String(sast.getUTCDate()).padStart(2, "0");
  const hours = String(sast.getUTCHours()).padStart(2, "0");
  const minutes = String(sast.getUTCMinutes()).padStart(2, "0");
  const seconds = String(sast.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+02:00`;
};
const resolveCompetitionStartAt = (content = {}) => {
  const configuredStart = new Date(content?.competitionStartsAtIso || "");
  if (!Number.isNaN(configuredStart.getTime())) {
    return configuredStart;
  }
  return getStartOfTodayLocal();
};
const parseRecentCompetitionWinners = (rawValue) => {
  if (!trimText(rawValue)) return [];
  try {
    const parsed = JSON.parse(String(rawValue));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item === "object");
  } catch (_error) {
    return [];
  }
};
const getRecentCompetitionWinners = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: RECENT_COMPETITION_WINNERS_KEY },
    select: { value: true },
  });
  return parseRecentCompetitionWinners(setting?.value);
};
const appendRecentCompetitionWinner = async (winnerRecord) => {
  const current = await getRecentCompetitionWinners();
  const next = [winnerRecord, ...current].slice(0, RECENT_COMPETITION_WINNERS_LIMIT);
  await prisma.appSetting.upsert({
    where: { key: RECENT_COMPETITION_WINNERS_KEY },
    create: {
      key: RECENT_COMPETITION_WINNERS_KEY,
      value: JSON.stringify(next),
    },
    update: {
      value: JSON.stringify(next),
    },
  });
  return next;
};

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

const buildCompetitionPointsLeaderboard = async ({
  rules,
  drawStartAt,
  drawEndAt,
}) => {
  const orders = await prisma.order.findMany({
    where: {
      status: "PAID",
      createdAt: {
        gte: drawStartAt,
        lte: drawEndAt,
      },
    },
    select: {
      id: true,
      userId: true,
      productsSubtotal: true,
      total: true,
      affiliateReferrerCode: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const entrantsByUser = new Map();

  orders.forEach((order) => {
    const pointsForOrder = calculateEntriesForOrder(order, rules);
    if (pointsForOrder <= 0) return;

    const existing = entrantsByUser.get(order.userId) || {
      userId: order.userId,
      name: trimText(order?.user?.name) || "Unnamed customer",
      email: trimText(order?.user?.email),
      points: 0,
      qualifyingOrders: 0,
      sampleOrderId: order.id,
    };

    existing.points += pointsForOrder;
    existing.qualifyingOrders += 1;
    entrantsByUser.set(order.userId, existing);
  });

  const entrants = Array.from(entrantsByUser.values()).sort(
    (a, b) => Number(b.points || 0) - Number(a.points || 0),
  );

  const totalPoints = entrants.reduce(
    (sum, entrant) => sum + Number(entrant.points || 0),
    0,
  );
  const totalQualifyingOrders = entrants.reduce(
    (sum, entrant) => sum + Number(entrant.qualifyingOrders || 0),
    0,
  );

  return {
    entrants,
    stats: {
      totalPoints,
      uniqueEntrants: entrants.length,
      qualifyingOrders: totalQualifyingOrders,
    },
  };
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
      deadlineLabel: resolveDeadlineLabel(content.endsAtIso, content.deadlineLabel),
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
  const competitionStartsAt = resolveCompetitionStartAt(content);
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
        createdAt: {
          gte: competitionStartsAt,
          ...(hasValidEndAt ? { lte: competitionEndsAt } : {}),
        },
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
    competitionHasEnded: isCompetitionExpired,
  });
};

exports.getAdminCompetitionRulesPage = async (req, res) => {
  const [rules, content, recentWinners] = await Promise.all([
    getCompetitionEntryRules(),
    getCompetitionContentSettings(),
    getRecentCompetitionWinners(),
  ]);
  const rawEndsAtIso = trimText(content?.endsAtIso);
  const endsAtLocalValue = rawEndsAtIso
    ? rawEndsAtIso.replace(/([+-]\d{2}:\d{2}|Z)$/i, "").slice(0, 16)
    : "";
  const effectiveStartAt = resolveCompetitionStartAt(content);
  const competitionStartsAtLocalValue =
    formatSastDateTimeLocalValue(effectiveStartAt);
  const countdownEndAt = new Date(content?.endsAtIso || "");
  const drawStartAt = resolveCompetitionStartAt(content);
  const hasValidCountdownEnd = !Number.isNaN(countdownEndAt.getTime());
  const drawReady = hasValidCountdownEnd ? Date.now() >= countdownEndAt.getTime() : false;
  const drawEndAt = hasValidCountdownEnd ? countdownEndAt : null;
  const pointsWindow = drawEndAt
    ? await buildCompetitionPointsLeaderboard({
        rules,
        drawStartAt,
        drawEndAt,
      })
    : {
        entrants: [],
        stats: {
          totalPoints: 0,
          uniqueEntrants: 0,
          qualifyingOrders: 0,
        },
      };

  return res.render("admin-competition-rules", {
    success: req.query.success || null,
    error: req.query.error || null,
    formData: rules,
    drawDefaults: {
      endsAtLocalValue,
      competitionStartsAtLocalValue,
      drawFromDate: formatDateInput(drawStartAt),
      drawToDate: formatDateInput(content?.endsAtIso),
      drawFromDateTime: formatDateTimeDisplay(drawStartAt),
      drawToDateTime: formatDateTimeDisplay(content?.endsAtIso),
      countdownEndIso: hasValidCountdownEnd ? countdownEndAt.toISOString() : "",
      drawReady,
    },
    pointsWindow,
    recentWinners,
  });
};

exports.drawAdminCompetitionWinner = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  const [rules, content] = await Promise.all([
    getCompetitionEntryRules(),
    getCompetitionContentSettings(),
  ]);

  const competitionEndAt = new Date(content?.endsAtIso || "");
  if (Number.isNaN(competitionEndAt.getTime())) {
    const message =
      "Countdown end date is not set. Please set a valid competition countdown end date/time in Competition Rules first.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }

  if (Date.now() < competitionEndAt.getTime()) {
    const message = `Draw is not ready yet. Countdown ends at ${formatDateTimeDisplay(competitionEndAt)}.`;
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }

  const drawStartAt = resolveCompetitionStartAt(content);
  if (drawStartAt.getTime() > competitionEndAt.getTime()) {
    const message =
      "Draw window is invalid (start is after end). Set Current Competition End to a time after the competition start, or start a new competition.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }

  const leaderboard = await buildCompetitionPointsLeaderboard({
    rules,
    drawStartAt,
    drawEndAt: competitionEndAt,
  });
  const entrants = leaderboard.entrants;
  const totalEntries = Number(leaderboard.stats.totalPoints || 0);

  if (!totalEntries || !entrants.length) {
    const payload = {
      success: false,
      message: "No eligible entries found for the selected draw window.",
      stats: {
        totalEntries: 0,
        qualifyingOrders: 0,
        uniqueEntrants: 0,
      },
    };
    if (wantsJson) {
      return res.status(400).json(payload);
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(payload.message)}`,
    );
  }

  let cumulativeEntries = 0;
  const weightedPool = entrants.map((entrant) => {
    cumulativeEntries += entrant.points;
    return {
      entrant,
      cumulativeEntries,
    };
  });

  const winningTicket = randomInt(totalEntries) + 1;
  const winningRecord =
    weightedPool.find((item) => winningTicket <= item.cumulativeEntries) ||
    weightedPool[weightedPool.length - 1];
  const winningEntrant = winningRecord.entrant;

  const winnerPayload = {
    ticketNumber: winningTicket,
    orderId: winningEntrant.sampleOrderId,
    entriesForWinningOrder: winningEntrant.points,
    drawnAtIso: new Date().toISOString(),
    winner: {
      userId: winningEntrant.userId,
      name: winningEntrant.name,
      email: winningEntrant.email,
      points: winningEntrant.points,
    },
    stats: {
      totalEntries,
      qualifyingOrders: Number(leaderboard.stats.qualifyingOrders || 0),
      uniqueEntrants: Number(leaderboard.stats.uniqueEntrants || 0),
    },
    filters: {
      drawFromDate: formatDateInput(drawStartAt),
      drawToDate: formatDateInput(competitionEndAt),
      drawFromDateTime: formatDateTimeDisplay(drawStartAt),
      drawToDateTime: formatDateTimeDisplay(competitionEndAt),
    },
  };

  try {
    await appendRecentCompetitionWinner({
      drawnAtIso: winnerPayload.drawnAtIso,
      orderId: winnerPayload.orderId,
      ticketNumber: winnerPayload.ticketNumber,
      totalEntries: Number(winnerPayload.stats?.totalEntries || 0),
      points: Number(winnerPayload.winner?.points || 0),
      name: winnerPayload.winner?.name || "Unnamed customer",
      email: winnerPayload.winner?.email || "",
    });
  } catch (error) {
    logger.warn("competition_recent_winner_store_failed", {
      error: error.message,
    });
  }

  return res.json({
    success: true,
    message: "Winner drawn successfully.",
    result: winnerPayload,
  });
};

exports.updateAdminCompetitionRules = async (req, res) => {
  const rawComingSoonValue = req.body?.comingSoonEnabled;
  const requestedComingSoonEnabled = parseSwitchOn(rawComingSoonValue);
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
    const comingSoonEnabled = requestedComingSoonEnabled;

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
        "Competition rules updated.",
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

exports.startAdminCompetitionWindow = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");
  const endsAtLocal = trimText(req.body?.endsAtLocal);
  const endsAtIso = endsAtLocal ? `${endsAtLocal}:00+02:00` : "";

  if (!endsAtLocal || Number.isNaN(new Date(endsAtIso).getTime())) {
    const message = "Please provide a valid competition end date and time.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }

  try {
    const [content, rules] = await Promise.all([
      getCompetitionContentSettings(),
      getCompetitionEntryRules(),
    ]);

    await saveCompetitionContentSettings({
      ...content,
      endsAtIso,
      deadlineLabel: resolveDeadlineLabel(endsAtIso, content.deadlineLabel),
      competitionStartsAtIso: formatSastIso(new Date()),
    });

    await saveCompetitionEntryRules({
      ...rules,
      comingSoonEnabled: false,
    });

    const message = "New competition started. Countdown updated and points window reset.";
    if (wantsJson) {
      return res.json({
        success: true,
        message,
        endsAtIso,
      });
    }
    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(message)}`,
    );
  } catch (error) {
    const message = error.message || "Unable to start new competition.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }
};

exports.updateAdminCompetitionCurrentEnd = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");
  const endsAtLocal = trimText(req.body?.endsAtLocal);
  const endsAtIso = endsAtLocal ? `${endsAtLocal}:00+02:00` : "";

  if (!endsAtLocal || Number.isNaN(new Date(endsAtIso).getTime())) {
    const message = "Please provide a valid competition end date and time.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }

  try {
    const content = await getCompetitionContentSettings();
    const proposedEndAt = new Date(endsAtIso);
    const currentStartAt = resolveCompetitionStartAt(content);

    if (proposedEndAt.getTime() < currentStartAt.getTime()) {
      const message =
        "End date/time cannot be earlier than the current competition start.";
      if (wantsJson) {
        return res.status(400).json({ success: false, message });
      }
      return res.redirect(
        `/admin/competition-rules?error=${encodeURIComponent(message)}`,
      );
    }

    await saveCompetitionContentSettings({
      ...content,
      endsAtIso,
      deadlineLabel: resolveDeadlineLabel(endsAtIso, content.deadlineLabel),
    });

    const message = "Current competition end date updated.";
    if (wantsJson) {
      return res.json({
        success: true,
        message,
        endsAtIso,
      });
    }
    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(message)}`,
    );
  } catch (error) {
    const message = error.message || "Unable to update current competition end date.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
    );
  }
};

exports.setAdminCompetitionEndNowForTest = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  try {
    const content = await getCompetitionContentSettings();
    const currentStartAt = resolveCompetitionStartAt(content);
    const now = new Date();
    const endAt = now.getTime() < currentStartAt.getTime() ? currentStartAt : now;
    const endsAtIso = formatSastIso(endAt);

    await saveCompetitionContentSettings({
      ...content,
      endsAtIso,
      deadlineLabel: resolveDeadlineLabel(endsAtIso, content.deadlineLabel),
    });

    const message = "Competition end set to now for testing.";
    if (wantsJson) {
      return res.json({
        success: true,
        message,
        endsAtIso,
      });
    }
    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(message)}`,
    );
  } catch (error) {
    const message = error.message || "Unable to set competition end for testing.";
    if (wantsJson) {
      return res.status(400).json({ success: false, message });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(message)}`,
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
        message: next.comingSoonEnabled
          ? "Entries are now paused (Coming Soon mode)."
          : "Entries are now live.",
      });
    }

    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(
        next.comingSoonEnabled
          ? "Entries are now paused (Coming Soon mode)."
          : "Entries are now live.",
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

exports.resetAdminCompetitionPointsWindow = async (req, res) => {
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  try {
    const currentContent = await getCompetitionContentSettings();
    const resetAtIso = formatSastIso(new Date());

    await saveCompetitionContentSettings({
      ...currentContent,
      competitionStartsAtIso: resetAtIso,
    });

    if (wantsJson) {
      return res.json({
        success: true,
        message: "Points window reset successfully.",
        resetAtIso,
      });
    }

    return res.redirect(
      `/admin/competition-rules?success=${encodeURIComponent(
        "Points window reset successfully.",
      )}`,
    );
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: error.message || "Unable to reset points window.",
      });
    }
    return res.redirect(
      `/admin/competition-rules?error=${encodeURIComponent(
        error.message || "Unable to reset points window.",
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
