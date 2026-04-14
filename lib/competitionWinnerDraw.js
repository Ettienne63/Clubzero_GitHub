const { randomInt } = require("crypto");
const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");
const { getCompetitionContentSettings } = require("./competitionContentSettings");
const { getCompetitionEntryRules } = require("./competitionEntryRules");

const COMPETITION_AUTO_WINNER_DRAW_STATE_KEY =
  "competition_auto_winner_draw_state";
const RECENT_COMPETITION_WINNERS_KEY = "competition_recent_winners";
const RECENT_COMPETITION_WINNERS_LIMIT = 25;
const COMPETITION_TIME_ZONE = "Africa/Johannesburg";
const COMPETITION_WINNER_REVEAL_DELAY_DAYS = 3;
const AUTO_WINNER_DRAW_INTERVAL_MS = 15 * 60 * 1000;

const trimText = (value) => (value || "").toString().trim();

const addDays = (value, days) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
};

const formatDateTimeDisplay = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const readable = new Intl.DateTimeFormat("en-ZA", {
    timeZone: COMPETITION_TIME_ZONE,
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  return `${readable} SAST`;
};

const resolveCompetitionStartAt = (content = {}) => {
  const configuredStart = new Date(content?.competitionStartsAtIso || "");
  if (!Number.isNaN(configuredStart.getTime())) {
    return configuredStart;
  }

  const now = new Date();
  const sastNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const year = sastNow.getUTCFullYear();
  const month = sastNow.getUTCMonth();
  const day = sastNow.getUTCDate();
  const utcMsAtSastMidnight =
    Date.UTC(year, month, day, 0, 0, 0) - 2 * 60 * 60 * 1000;
  return new Date(utcMsAtSastMidnight);
};

const resolveWinnerRevealAt = (endsAtIso, winnerRevealAtIso = "") => {
  const explicitRevealAt = new Date(winnerRevealAtIso || "");
  if (!Number.isNaN(explicitRevealAt.getTime())) {
    return explicitRevealAt;
  }

  return addDays(endsAtIso, COMPETITION_WINNER_REVEAL_DELAY_DAYS);
};

const resolveWinnerRevealLabel = (
  endsAtIso,
  winnerRevealAtIso = "",
  fallbackLabel = "",
) => {
  const revealAt = resolveWinnerRevealAt(endsAtIso, winnerRevealAtIso);
  return revealAt ? formatDateTimeDisplay(revealAt) : trimText(fallbackLabel);
};

const parseStoredState = (value) => {
  if (!trimText(value)) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
};

const getRecentCompetitionWinners = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: RECENT_COMPETITION_WINNERS_KEY },
    select: { value: true },
  });

  const parsed = parseStoredState(setting?.value);
  return Array.isArray(parsed)
    ? parsed.filter((item) => item && typeof item === "object")
    : [];
};

const appendRecentCompetitionWinner = async (winnerRecord) => {
  const current = await getRecentCompetitionWinners();
  const next = [winnerRecord, ...current].slice(
    0,
    RECENT_COMPETITION_WINNERS_LIMIT,
  );
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

const getAutoWinnerDrawState = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: COMPETITION_AUTO_WINNER_DRAW_STATE_KEY },
    select: { value: true },
  });
  return parseStoredState(setting?.value);
};

const setAutoWinnerDrawState = async (state) => {
  await prisma.appSetting.upsert({
    where: { key: COMPETITION_AUTO_WINNER_DRAW_STATE_KEY },
    create: {
      key: COMPETITION_AUTO_WINNER_DRAW_STATE_KEY,
      value: JSON.stringify(state),
    },
    update: {
      value: JSON.stringify(state),
    },
  });
};

const calculateEntriesForOrder = (order, rules) => {
  const subtotal = Number(order?.productsSubtotal ?? order?.total ?? 0);
  let entries = 0;

  if (subtotal >= rules.tierTwoMinSubtotal) {
    entries = rules.tierTwoEntries;
  } else if (subtotal >= rules.tierOneMinSubtotal) {
    entries = rules.tierOneEntries;
  }

  if (entries > 0 && String(order?.affiliateReferrerCode || "").trim()) {
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

const drawCompetitionWinner = async ({
  rules,
  content,
  recordState = true,
}) => {
  const competitionEndAt = new Date(content?.endsAtIso || "");
  if (Number.isNaN(competitionEndAt.getTime())) {
    throw new Error(
      "Countdown end date is not set. Please set a valid competition countdown end date/time first.",
    );
  }

  const drawStartAt = resolveCompetitionStartAt(content);
  if (drawStartAt.getTime() > competitionEndAt.getTime()) {
    throw new Error(
      "Draw window is invalid (start is after end). Set Current Competition End to a time after the competition start, or start a new competition.",
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
    throw new Error("No eligible entries found for the selected draw window.");
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
  const drawnAtIso = new Date().toISOString();
  const revealAtIso =
    resolveWinnerRevealAt(
      content.endsAtIso,
      content.winnerRevealAtIso,
    )?.toISOString() || "";

  const winnerPayload = {
    ticketNumber: winningTicket,
    orderId: winningEntrant.sampleOrderId,
    entriesForWinningOrder: winningEntrant.points,
    drawnAtIso,
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
      drawFromDate: drawStartAt.toISOString().slice(0, 10),
      drawToDate: competitionEndAt.toISOString().slice(0, 10),
      drawFromDateTime: formatDateTimeDisplay(drawStartAt),
      drawToDateTime: formatDateTimeDisplay(competitionEndAt),
      revealAtDateTime: formatDateTimeDisplay(revealAtIso || competitionEndAt),
    },
    revealAtIso,
  };

  await appendRecentCompetitionWinner({
    drawnAtIso: winnerPayload.drawnAtIso,
    orderId: winnerPayload.orderId,
    ticketNumber: winnerPayload.ticketNumber,
    totalEntries: Number(winnerPayload.stats?.totalEntries || 0),
    points: Number(winnerPayload.winner?.points || 0),
    name: winnerPayload.winner?.name || "Unnamed customer",
    email: winnerPayload.winner?.email || "",
  });

  if (recordState) {
    await setAutoWinnerDrawState({
      competitionEndsAtIso: content.endsAtIso,
      drawAtIso: competitionEndAt.toISOString(),
      revealAtIso,
      drawnAtIso: winnerPayload.drawnAtIso,
      winner: winnerPayload.winner,
      ticketNumber: winnerPayload.ticketNumber,
      orderId: winnerPayload.orderId,
      stats: winnerPayload.stats,
    });
  }

  return winnerPayload;
};

const runAutoCompetitionWinnerDraw = async () => {
  const [rules, content] = await Promise.all([
    getCompetitionEntryRules(),
    getCompetitionContentSettings(),
  ]);

  const competitionEndAt = new Date(content?.endsAtIso || "");
  if (Number.isNaN(competitionEndAt.getTime())) {
    return { skipped: true, reason: "invalid_end_date" };
  }

  const revealAt = resolveWinnerRevealAt(
    content.endsAtIso,
    content.winnerRevealAtIso,
  );
  if (!revealAt) {
    return { skipped: true, reason: "invalid_reveal_date" };
  }

  const now = Date.now();
  if (now < competitionEndAt.getTime()) {
    return {
      skipped: true,
      reason: "not_due_yet",
      drawAtIso: competitionEndAt.toISOString(),
    };
  }

  const currentState = await getAutoWinnerDrawState();
  if (
    currentState &&
    currentState.competitionEndsAtIso === content.endsAtIso &&
    currentState.drawAtIso &&
    currentState.drawnAtIso
  ) {
    return { skipped: true, reason: "already_drawn", state: currentState };
  }

  const winnerPayload = await drawCompetitionWinner({ rules, content });

  logger.info("competition_auto_winner_drawn", {
    competitionEndsAtIso: content.endsAtIso,
    drawAtIso: competitionEndAt.toISOString(),
    winnerName: winnerPayload.winner?.name || "Unnamed customer",
    orderId: winnerPayload.orderId,
  });

  return { success: true, result: winnerPayload };
};

const startCompetitionWinnerDrawScheduler = () => {
  const enabled =
    String(process.env.COMPETITION_AUTO_DRAW_ENABLED || "true").toLowerCase() !==
    "false";
  if (!enabled) {
    logger.info("competition_auto_winner_draw_scheduler_disabled", {
      reason: "disabled",
    });
    return null;
  }

  const runOnce = async () => {
    try {
      await runAutoCompetitionWinnerDraw();
    } catch (error) {
      logger.warn("competition_auto_winner_draw_failed", {
        error: error.message,
      });
    }
  };

  void runOnce();
  const intervalMs = AUTO_WINNER_DRAW_INTERVAL_MS;
  const timer = setInterval(runOnce, intervalMs);
  logger.info("competition_auto_winner_draw_scheduler_started", {
    intervalMinutes: intervalMs / (60 * 1000),
  });
  return timer;
};

module.exports = {
  appendRecentCompetitionWinner,
  buildCompetitionPointsLeaderboard,
  drawCompetitionWinner,
  getAutoWinnerDrawState,
  getRecentCompetitionWinners,
  resolveCompetitionStartAt,
  resolveWinnerRevealAt,
  resolveWinnerRevealLabel,
  resolveWinnerAnnouncementAt: resolveWinnerRevealAt,
  resolveWinnerAnnouncementLabel: resolveWinnerRevealLabel,
  runAutoCompetitionWinnerDraw,
  setAutoWinnerDrawState,
  startCompetitionWinnerDrawScheduler,
};
