const { prisma } = require("../prisma/lib/prisma");
const { logger } = require("./logger");
const { getPromoSettings } = require("./promoSettings");
const { getDiscountedPrice } = require("./pricing");
const { sendEmail } = require("./email");

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const buildBaseUrl = () => {
  const raw = (process.env.PUBLIC_BASE_URL || "").trim();
  if (raw) {
    return raw.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
};

const buildCartEmail = ({ user, cartItems, total, baseUrl }) => {
  const greeting = user.name ? `Hi ${user.name},` : "Hi there,";
  const cartLines = cartItems
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const name = item.product?.name || "Club Zero";
      return `- ${name} x${qty}`;
    })
    .join("\n");

  const subject = "You left items in your Club Zero cart";
  const text = [
    greeting,
    "",
    "We saved the items you added to your cart.",
    "",
    cartLines || "- Items in your cart",
    "",
    `Estimated total: R${Number(total).toFixed(2)}`,
    "",
    `Complete your order: ${baseUrl}/auth/cart`,
    "",
    "Need help? Reply to this email or contact us from the website.",
  ].join("\n");

  return { subject, text };
};

const getCartTotal = (cartItems, discountsEnabled) =>
  cartItems.reduce((sum, item) => {
    const product = item.product || {};
    const discountPercent =
      discountsEnabled && product.discountEnabled !== false
        ? product.discountPercent
        : 0;
    const unitPrice = getDiscountedPrice(product.price, discountPercent);
    return sum + unitPrice * Number(item.quantity || 0);
  }, 0);

const fetchCandidates = async ({ threshold, resendThreshold, maxSends, batch }) =>
  prisma.user.findMany({
    where: {
      email: { not: null },
      lastCartActivityAt: { not: null, lte: threshold },
      abandonedCartEmailCount: { lt: maxSends },
      cartItems: { some: {} },
      OR: [
        { lastAbandonedCartEmailAt: null },
        { lastAbandonedCartEmailAt: { lte: resendThreshold } },
      ],
    },
    select: {
      id: true,
      email: true,
      name: true,
      abandonedCartEmailCount: true,
      lastCartActivityAt: true,
    },
    take: batch,
  });

const runAbandonedCartReminders = async () => {
  const enabled =
    String(process.env.ABANDONED_CART_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    return { skipped: true, reason: "disabled" };
  }

  const delayHours = parseNumber(process.env.ABANDONED_CART_DELAY_HOURS, 24);
  const resendHours = parseNumber(process.env.ABANDONED_CART_RESEND_HOURS, 72);
  const maxSends = parseNumber(process.env.ABANDONED_CART_MAX_SENDS, 2);
  const batch = parseNumber(process.env.ABANDONED_CART_BATCH, 50);
  const now = new Date();
  const threshold = new Date(now.getTime() - delayHours * 60 * 60 * 1000);
  const resendThreshold = new Date(now.getTime() - resendHours * 60 * 60 * 1000);
  const baseUrl = buildBaseUrl();
  const promoSettings = await getPromoSettings();
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );

  const candidates = await fetchCandidates({
    threshold,
    resendThreshold,
    maxSends,
    batch,
  });

  let sent = 0;

  for (const user of candidates) {
    const cartItems = await prisma.cartItem.findMany({
      where: { userId: user.id },
      include: {
        product: {
          select: {
            name: true,
            price: true,
            discountPercent: true,
            discountEnabled: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    if (!cartItems.length) {
      continue;
    }

    const total = getCartTotal(cartItems, discountsEnabled);
    const { subject, text } = buildCartEmail({
      user,
      cartItems,
      total,
      baseUrl,
    });
    const result = await sendEmail({ to: user.email, subject, text });

    if (result.sent) {
      sent += 1;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastAbandonedCartEmailAt: now,
          abandonedCartEmailCount: { increment: 1 },
        },
      });
    }
  }

  return { sent, processed: candidates.length };
};

const startAbandonedCartScheduler = () => {
  const enabled =
    String(process.env.ABANDONED_CART_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    logger.info("abandoned_cart_scheduler_disabled");
    return null;
  }

  const intervalMinutes = parseNumber(
    process.env.ABANDONED_CART_INTERVAL_MINUTES,
    30,
  );
  const intervalMs = Math.max(5, intervalMinutes) * 60 * 1000;

  let running = false;
  const runOnce = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await runAbandonedCartReminders();
      logger.info("abandoned_cart_run", result);
    } catch (error) {
      logger.error("abandoned_cart_run_failed", { error: error.message });
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(runOnce, intervalMs);
  logger.info("abandoned_cart_scheduler_started", { intervalMinutes });
  return () => clearInterval(timer);
};

module.exports = {
  startAbandonedCartScheduler,
  runAbandonedCartReminders,
};
