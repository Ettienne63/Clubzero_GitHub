const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("./logger");

const RETAIL_PROFIT_TRACKER_SETTING_KEY = "retail_profit_tracker_entries_v1";
const SETTINGS_CACHE_TTL_MS = 30 * 1000;
let cachedTracker = null;
let cachedTrackerLoadedAt = 0;
let prismaClient = null;

const KEYWORD_GROUPS = {
  revenue: ["revenue", "total revenue", "sales", "turnover"],
  profit: ["profit", "net profit", "gross profit", "net income"],
};

const normalizeText = (value = "") =>
  String(value || "")
    .trim()
    .toLowerCase();

const parseNumericValue = (value) => {
  const source = String(value ?? "").trim();
  if (!source) return null;

  const hasParentheses = source.includes("(") && source.includes(")");
  const cleaned = source
    .replace(/[Rr$€£¥]/g, "")
    .replace(/\s/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, "");

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return hasParentheses ? -Math.abs(parsed) : parsed;
};

const extractLineValue = (line = "") => {
  const match = String(line).match(/[-(]?\d[\d,\s]*(?:\.\d+)?\)?/g);
  if (!match || !match.length) return null;
  for (let index = match.length - 1; index >= 0; index -= 1) {
    const parsed = parseNumericValue(match[index]);
    if (parsed !== null) return parsed;
  }
  return null;
};

const extractValuesFromText = (text = "") => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let revenue = null;
  let profit = null;

  lines.forEach((line) => {
    const lineNormalized = normalizeText(line);
    if (revenue === null) {
      const hasRevenueKeyword = KEYWORD_GROUPS.revenue.some((keyword) =>
        lineNormalized.includes(keyword),
      );
      if (hasRevenueKeyword) {
        revenue = extractLineValue(line);
      }
    }

    if (profit === null) {
      const hasProfitKeyword = KEYWORD_GROUPS.profit.some((keyword) =>
        lineNormalized.includes(keyword),
      );
      if (hasProfitKeyword) {
        profit = extractLineValue(line);
      }
    }
  });

  return {
    revenue,
    profit,
  };
};

const findColumnIndex = (headers = [], keywordList = []) =>
  headers.findIndex((header) => {
    const normalized = normalizeText(header);
    return keywordList.some((keyword) => normalized.includes(keyword));
  });

const parseExcelFile = async (filePath) => {
  let XLSX;
  try {
    XLSX = require("xlsx");
  } catch (error) {
    throw new Error(
      "Excel parsing dependency is missing. Install with: npm install xlsx",
    );
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  let revenue = 0;
  let profit = 0;
  let revenueFound = false;
  let profitFound = false;
  let fallbackText = "";
  let rowsParsed = 0;
  let sheetsScanned = 0;
  let revenueColumnFound = false;
  let profitColumnFound = false;

  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) return;
    sheetsScanned += 1;
    fallbackText += `${XLSX.utils.sheet_to_csv(worksheet)}\n`;

    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    if (!rows.length) return;

    const [headerRow, ...dataRows] = rows;
    const revenueIndex = findColumnIndex(headerRow, KEYWORD_GROUPS.revenue);
    const profitIndex = findColumnIndex(headerRow, KEYWORD_GROUPS.profit);
    rowsParsed += dataRows.length;
    if (revenueIndex >= 0) {
      revenueColumnFound = true;
    }
    if (profitIndex >= 0) {
      profitColumnFound = true;
    }

    if (revenueIndex === -1 && profitIndex === -1) {
      return;
    }

    dataRows.forEach((row) => {
      if (!Array.isArray(row)) return;
      if (revenueIndex >= 0) {
        const parsedRevenue = parseNumericValue(row[revenueIndex]);
        if (parsedRevenue !== null) {
          revenue += parsedRevenue;
          revenueFound = true;
        }
      }
      if (profitIndex >= 0) {
        const parsedProfit = parseNumericValue(row[profitIndex]);
        if (parsedProfit !== null) {
          profit += parsedProfit;
          profitFound = true;
        }
      }
    });
  });

  if (!revenueFound || !profitFound) {
    const fallback = extractValuesFromText(fallbackText);
    if (!revenueFound && fallback.revenue !== null) {
      revenue = fallback.revenue;
      revenueFound = true;
    }
    if (!profitFound && fallback.profit !== null) {
      profit = fallback.profit;
      profitFound = true;
    }
  }

  const warnings = [];
  if (!revenueFound) {
    warnings.push("Revenue value not found");
  }
  if (!profitFound) {
    warnings.push("Profit value not found");
  }

  return {
    revenue: revenueFound ? Number(revenue.toFixed(2)) : null,
    profit: profitFound ? Number(profit.toFixed(2)) : null,
    insights: {
      source: "excel",
      sheetsScanned,
      rowsParsed,
      fieldsDetected: {
        revenue: revenueFound,
        profit: profitFound,
        revenueColumn: revenueColumnFound,
        profitColumn: profitColumnFound,
      },
      warnings,
    },
  };
};

const parsePdfFile = async (filePath) => {
  let pdfParse;
  try {
    pdfParse = require("pdf-parse");
  } catch (error) {
    throw new Error(
      "PDF parsing dependency is missing. Install with: npm install pdf-parse",
    );
  }

  const buffer = await fs.promises.readFile(filePath);
  const parsed = await pdfParse(buffer);
  const extracted = extractValuesFromText(parsed?.text || "");
  const linesScanned = String(parsed?.text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
  const warnings = [];
  if (extracted.revenue === null) {
    warnings.push("Revenue value not found");
  }
  if (extracted.profit === null) {
    warnings.push("Profit value not found");
  }
  return {
    revenue:
      extracted.revenue !== null ? Number(extracted.revenue.toFixed(2)) : null,
    profit: extracted.profit !== null ? Number(extracted.profit.toFixed(2)) : null,
    insights: {
      source: "pdf",
      linesScanned,
      fieldsDetected: {
        revenue: extracted.revenue !== null,
        profit: extracted.profit !== null,
      },
      warnings,
    },
  };
};

const parseRetailProfitFile = async (file) => {
  if (!file || !file.path) {
    throw new Error("No upload was provided.");
  }

  const extension = path.extname(String(file.originalname || file.filename || "")).toLowerCase();
  if (extension === ".pdf") {
    return parsePdfFile(file.path);
  }
  if ([".xlsx", ".xls", ".csv"].includes(extension)) {
    return parseExcelFile(file.path);
  }

  throw new Error("Unsupported file type. Upload PDF, XLSX, XLS, or CSV.");
};

const parseStoredTracker = (raw = "") => {
  try {
    const parsed = JSON.parse(String(raw || ""));
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return {
      entries: entries
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          id: String(entry.id || ""),
          uploadedAt: String(entry.uploadedAt || ""),
          originalName: String(entry.originalName || ""),
          fileUrl: String(entry.fileUrl || ""),
          revenue:
            entry.revenue === null || entry.revenue === undefined
              ? null
              : Number(entry.revenue),
          profit:
            entry.profit === null || entry.profit === undefined
              ? null
              : Number(entry.profit),
          parseInsights:
            entry.parseInsights && typeof entry.parseInsights === "object"
              ? {
                  source: String(entry.parseInsights.source || ""),
                  rowsParsed: Number(entry.parseInsights.rowsParsed || 0),
                  linesScanned: Number(entry.parseInsights.linesScanned || 0),
                  sheetsScanned: Number(entry.parseInsights.sheetsScanned || 0),
                  fieldsDetected:
                    entry.parseInsights.fieldsDetected &&
                    typeof entry.parseInsights.fieldsDetected === "object"
                      ? {
                          revenue: Boolean(entry.parseInsights.fieldsDetected.revenue),
                          profit: Boolean(entry.parseInsights.fieldsDetected.profit),
                          revenueColumn: Boolean(
                            entry.parseInsights.fieldsDetected.revenueColumn,
                          ),
                          profitColumn: Boolean(
                            entry.parseInsights.fieldsDetected.profitColumn,
                          ),
                        }
                      : null,
                  warnings: Array.isArray(entry.parseInsights.warnings)
                    ? entry.parseInsights.warnings
                        .map((warning) => String(warning || "").trim())
                        .filter(Boolean)
                        .slice(0, 3)
                    : [],
                }
              : null,
        })),
    };
  } catch (_error) {
    return { entries: [] };
  }
};

const getPrisma = () => {
  if (prismaClient) {
    return prismaClient;
  }
  // Lazy-load so unit tests can run without a generated Prisma client.
  ({ prisma: prismaClient } = require("../prisma/lib/prisma"));
  return prismaClient;
};

const getRetailProfitTracker = async () => {
  if (
    cachedTracker &&
    Date.now() - cachedTrackerLoadedAt < SETTINGS_CACHE_TTL_MS
  ) {
    return cachedTracker;
  }

  try {
    const prisma = getPrisma();
    const setting = await prisma.appSetting.findUnique({
      where: { key: RETAIL_PROFIT_TRACKER_SETTING_KEY },
      select: { value: true },
    });
    cachedTracker = parseStoredTracker(setting?.value || "");
    cachedTrackerLoadedAt = Date.now();
    return cachedTracker;
  } catch (error) {
    logger.warn("retail_profit_tracker_load_failed", { error: error.message });
    if (cachedTracker) return cachedTracker;
    return { entries: [] };
  }
};

const saveRetailProfitTracker = async (tracker) => {
  const normalized = {
    entries: Array.isArray(tracker?.entries) ? tracker.entries : [],
  };

  const prisma = getPrisma();
  await prisma.appSetting.upsert({
    where: { key: RETAIL_PROFIT_TRACKER_SETTING_KEY },
    create: {
      key: RETAIL_PROFIT_TRACKER_SETTING_KEY,
      value: JSON.stringify(normalized),
    },
    update: {
      value: JSON.stringify(normalized),
    },
  });

  cachedTracker = normalized;
  cachedTrackerLoadedAt = Date.now();
  return normalized;
};

const addRetailProfitEntry = async ({
  file,
  revenue = null,
  profit = null,
  parseInsights = null,
}) => {
  const current = await getRetailProfitTracker();
  const nextEntry = {
    id: crypto.randomUUID(),
    uploadedAt: new Date().toISOString(),
    originalName: String(file.originalname || file.filename || "upload"),
    fileUrl: `/uploads/${String(file.filename || "").trim()}`,
    revenue: revenue === null ? null : Number(revenue),
    profit: profit === null ? null : Number(profit),
    parseInsights:
      parseInsights && typeof parseInsights === "object"
        ? {
            source: String(parseInsights.source || ""),
            rowsParsed: Number(parseInsights.rowsParsed || 0),
            linesScanned: Number(parseInsights.linesScanned || 0),
            sheetsScanned: Number(parseInsights.sheetsScanned || 0),
            fieldsDetected:
              parseInsights.fieldsDetected &&
              typeof parseInsights.fieldsDetected === "object"
                ? {
                    revenue: Boolean(parseInsights.fieldsDetected.revenue),
                    profit: Boolean(parseInsights.fieldsDetected.profit),
                    revenueColumn: Boolean(
                      parseInsights.fieldsDetected.revenueColumn,
                    ),
                    profitColumn: Boolean(
                      parseInsights.fieldsDetected.profitColumn,
                    ),
                  }
                : null,
            warnings: Array.isArray(parseInsights.warnings)
              ? parseInsights.warnings
                  .map((warning) => String(warning || "").trim())
                  .filter(Boolean)
                  .slice(0, 3)
              : [],
          }
        : null,
  };

  return saveRetailProfitTracker({
    entries: [nextEntry, ...current.entries],
  });
};

const buildRetailProfitSummary = (tracker) => {
  const entries = Array.isArray(tracker?.entries) ? tracker.entries : [];
  return entries.reduce(
    (acc, entry) => {
      acc.uploadCount += 1;
      if (Number.isFinite(entry.revenue)) {
        acc.totalRevenue += Number(entry.revenue);
      }
      if (Number.isFinite(entry.profit)) {
        acc.totalProfit += Number(entry.profit);
      }
      return acc;
    },
    {
      uploadCount: 0,
      totalRevenue: 0,
      totalProfit: 0,
    },
  );
};

module.exports = {
  getRetailProfitTracker,
  addRetailProfitEntry,
  parseRetailProfitFile,
  buildRetailProfitSummary,
  __test__: {
    parseNumericValue,
    extractValuesFromText,
  },
};
