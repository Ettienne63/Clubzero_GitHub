const { prisma } = require("../prisma/lib/prisma");
const { sendEmail } = require("./email");
const { logger } = require("./logger");

const LOW_STOCK_EMAILS_ENABLED_KEY = "low_stock_emails_enabled";
const OUT_OF_STOCK_SUMMARY_LAST_SENT_KEY = "out_of_stock_summary_last_sent_date";
const OUT_OF_STOCK_SUMMARY_DEFAULT_RECIPIENT = "info@clubzero.co.za";
const PRIVATE_SELLER_TAG = "[private seller - no store location]";

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const parseNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getSummaryTimezone = () =>
  (process.env.OUT_OF_STOCK_SUMMARY_TZ || "").toString().trim() || "Africa/Johannesburg";

const getSummaryRecipient = () =>
  (process.env.LOW_STOCK_ALERT_EMAIL || "").toString().trim() ||
  OUT_OF_STOCK_SUMMARY_DEFAULT_RECIPIENT;

const getDateParts = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const lookup = (type) => parts.find((part) => part.type === type)?.value || "00";

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: Number.parseInt(lookup("hour"), 10) || 0,
    minute: Number.parseInt(lookup("minute"), 10) || 0,
  };
};

const getDateKeyInTimezone = (date, timeZone) => {
  const parts = getDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isLowStockEmailsEnabled = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: LOW_STOCK_EMAILS_ENABLED_KEY },
    select: { value: true },
  });

  if (!setting) {
    return true;
  }

  return String(setting.value || "").toLowerCase() !== "false";
};

const shouldSendNow = ({ now, timeZone, targetHour, targetMinute }) => {
  const { hour, minute } = getDateParts(now, timeZone);
  if (hour > targetHour) {
    return true;
  }
  if (hour < targetHour) {
    return false;
  }
  return minute >= targetMinute;
};

const getLastSentDateKey = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: OUT_OF_STOCK_SUMMARY_LAST_SENT_KEY },
    select: { value: true },
  });

  return (setting?.value || "").toString().trim() || null;
};

const setLastSentDateKey = async (dateKey) => {
  await prisma.appSetting.upsert({
    where: { key: OUT_OF_STOCK_SUMMARY_LAST_SENT_KEY },
    create: { key: OUT_OF_STOCK_SUMMARY_LAST_SENT_KEY, value: dateKey },
    update: { value: dateKey },
  });
};

const fetchOutOfStockProducts = async () => {
  const [websiteProducts, supplierProducts] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        websiteStock: { lte: 0 },
      },
      select: {
        id: true,
        name: true,
        websiteStock: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.supplierCustomProduct.findMany({
      where: {
        quantity: { lte: 0 },
      },
      select: {
        id: true,
        name: true,
        quantity: true,
        supplier: {
          select: {
            name: true,
            notes: true,
          },
        },
      },
      orderBy: [{ supplier: { name: "asc" } }, { name: "asc" }],
    }),
  ]);

  return { websiteProducts, supplierProducts };
};

const buildSummaryEmail = ({ websiteProducts, supplierProducts, timeZone, dateKey }) => {
  const privateSupplierProducts = supplierProducts.filter((product) =>
    String(product.supplier?.notes || "").toLowerCase().includes(PRIVATE_SELLER_TAG),
  );
  const standardSupplierProducts = supplierProducts.filter(
    (product) =>
      !String(product.supplier?.notes || "").toLowerCase().includes(PRIVATE_SELLER_TAG),
  );

  const subject = `Club Zero daily out-of-stock summary (${dateKey}, ${timeZone})`;
  const websiteLines = websiteProducts.map(
    (product) => `- ${product.name} (stock: ${Number(product.websiteStock || 0)})`,
  );
  const supplierLines = standardSupplierProducts.map(
    (product) =>
      `- ${product.supplier?.name || "Unknown supplier"}: ${product.name} (stock: ${Number(product.quantity || 0)})`,
  );
  const privateSupplierLines = privateSupplierProducts.map(
    (product) =>
      `- ${product.supplier?.name || "Unknown seller"}: ${product.name} (stock: ${Number(product.quantity || 0)})`,
  );
  const text = [
    "Daily out-of-stock summary:",
    "",
    "Website products (active):",
    ...(websiteLines.length ? websiteLines : ["- None"]),
    "",
    "Supplier products:",
    ...(supplierLines.length ? supplierLines : ["- None"]),
    "",
    "Privately owned products:",
    ...(privateSupplierLines.length ? privateSupplierLines : ["- None"]),
    "",
    `Total website out-of-stock: ${websiteProducts.length}`,
    `Total supplier out-of-stock: ${standardSupplierProducts.length}`,
    `Total privately owned out-of-stock: ${privateSupplierProducts.length}`,
    `Total out-of-stock items: ${websiteProducts.length + supplierProducts.length}`,
  ].join("\n");

  const renderHtmlList = (items, formatter) =>
    items.length
      ? `<ul style="margin:0;padding-left:18px;">${items
          .map((item) => `<li style="margin:0 0 4px;">${formatter(item)}</li>`)
          .join("")}</ul>`
      : '<p style="margin:0;color:#6b7280;">None</p>';

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111827;">
  <p style="margin:0 0 12px;"><strong>Daily out-of-stock summary</strong> (${escapeHtml(dateKey)}, ${escapeHtml(timeZone)})</p>

  <p style="margin:0 0 6px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#6c757d;color:#ffffff;font-weight:600;">Website</span></p>
  ${renderHtmlList(
    websiteProducts,
    (product) =>
      `${escapeHtml(product.name)} (stock: ${Number(product.websiteStock || 0)})`,
  )}

  <p style="margin:14px 0 6px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#0d6efd;color:#ffffff;font-weight:600;">Supplier</span></p>
  ${renderHtmlList(
    standardSupplierProducts,
    (product) =>
      `${escapeHtml(product.supplier?.name || "Unknown supplier")}: ${escapeHtml(product.name)} (stock: ${Number(product.quantity || 0)})`,
  )}

  <p style="margin:14px 0 6px;"><span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#0dcaf0;color:#052c65;font-weight:600;">Privately Owned</span></p>
  ${renderHtmlList(
    privateSupplierProducts,
    (product) =>
      `${escapeHtml(product.supplier?.name || "Unknown seller")}: ${escapeHtml(product.name)} (stock: ${Number(product.quantity || 0)})`,
  )}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:14px 0;" />
  <p style="margin:0 0 4px;"><strong>Total website out-of-stock:</strong> ${websiteProducts.length}</p>
  <p style="margin:0 0 4px;"><strong>Total supplier out-of-stock:</strong> ${standardSupplierProducts.length}</p>
  <p style="margin:0 0 4px;"><strong>Total privately owned out-of-stock:</strong> ${privateSupplierProducts.length}</p>
  <p style="margin:0;"><strong>Total out-of-stock items:</strong> ${websiteProducts.length + supplierProducts.length}</p>
</div>`.trim();

  return { subject, text, html };
};

const runDailyOutOfStockSummary = async () => {
  const enabled = String(process.env.OUT_OF_STOCK_SUMMARY_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    return { skipped: true, reason: "disabled" };
  }

  const alertsEnabled = await isLowStockEmailsEnabled();
  if (!alertsEnabled) {
    return { skipped: true, reason: "alerts_disabled" };
  }

  const timeZone = getSummaryTimezone();
  const targetHour = Math.min(23, Math.max(0, parseNumber(process.env.OUT_OF_STOCK_SUMMARY_HOUR, 21)));
  const targetMinute = Math.min(59, Math.max(0, parseNumber(process.env.OUT_OF_STOCK_SUMMARY_MINUTE, 0)));
  const now = new Date();

  if (!shouldSendNow({ now, timeZone, targetHour, targetMinute })) {
    return { skipped: true, reason: "before_send_time" };
  }

  const dateKey = getDateKeyInTimezone(now, timeZone);
  const lastSentDateKey = await getLastSentDateKey();
  if (lastSentDateKey === dateKey) {
    return { skipped: true, reason: "already_sent_today" };
  }

  const { websiteProducts, supplierProducts } = await fetchOutOfStockProducts();
  if (!websiteProducts.length && !supplierProducts.length) {
    return { skipped: true, reason: "no_out_of_stock_products" };
  }

  const recipient = getSummaryRecipient();
  const { subject, text, html } = buildSummaryEmail({
    websiteProducts,
    supplierProducts,
    timeZone,
    dateKey,
  });

  const result = await sendEmail({
    to: recipient,
    subject,
    text,
    html,
  });

  if (!result.sent) {
    return { sent: false, reason: result.reason || "send_failed" };
  }

  await setLastSentDateKey(dateKey);

  return {
    sent: true,
    recipient,
    websiteCount: websiteProducts.length,
    supplierCount: supplierProducts.length,
    count: websiteProducts.length + supplierProducts.length,
    dateKey,
    timeZone,
  };
};

const startDailyOutOfStockSummaryScheduler = () => {
  const enabled = String(process.env.OUT_OF_STOCK_SUMMARY_ENABLED || "true").toLowerCase() !== "false";
  if (!enabled) {
    logger.info("out_of_stock_summary_scheduler_disabled", { reason: "disabled" });
    return null;
  }

  const intervalMinutes = Math.max(
    5,
    parseNumber(process.env.OUT_OF_STOCK_SUMMARY_INTERVAL_MINUTES, 30),
  );
  const intervalMs = intervalMinutes * 60 * 1000;

  let running = false;
  const runOnce = async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      const result = await runDailyOutOfStockSummary();
      logger.info("out_of_stock_summary_run", result);
    } catch (error) {
      logger.error("out_of_stock_summary_run_failed", { error: error.message });
    } finally {
      running = false;
    }
  };

  void runOnce();
  const timer = setInterval(runOnce, intervalMs);
  logger.info("out_of_stock_summary_scheduler_started", {
    intervalMinutes,
    timeZone: getSummaryTimezone(),
  });

  return () => clearInterval(timer);
};

module.exports = {
  runDailyOutOfStockSummary,
  startDailyOutOfStockSummaryScheduler,
};
