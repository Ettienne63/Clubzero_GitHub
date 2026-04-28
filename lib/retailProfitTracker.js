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
  customerName: ["customer", "customer name", "name", "client"],
  quantity: ["quantity", "qty", "units", "bottles", "cases"],
  itemTotal: ["item total", "line total", "item amount", "line amount"],
  subTotal: ["sub total", "subtotal"],
  total: ["total", "grand total", "invoice total"],
  balance: ["balance", "amount due", "outstanding"],
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

const getCell = (row, index) => {
  if (!Array.isArray(row) || index < 0) return "";
  return row[index];
};

const toNumberOrZero = (value) => {
  const parsed = parseNumericValue(value);
  return parsed === null ? 0 : Number(parsed);
};

const parseRetailCustomerRows = (rows = []) => {
  if (!Array.isArray(rows) || !rows.length) {
    return [];
  }

  const headerSearchLimit = Math.min(rows.length, 12);
  let headerIndex = -1;
  let columnMap = null;

  for (let i = 0; i < headerSearchLimit; i += 1) {
    const candidateHeaders = Array.isArray(rows[i]) ? rows[i] : [];
    const map = {
      customerName: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.customerName),
      quantity: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.quantity),
      itemTotal: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.itemTotal),
      subTotal: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.subTotal),
      total: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.total),
      balance: findColumnIndex(candidateHeaders, KEYWORD_GROUPS.balance),
    };
    const matched =
      Object.values(map).filter((index) => Number.isInteger(index) && index >= 0)
        .length;
    if (map.customerName >= 0 && matched >= 2) {
      headerIndex = i;
      columnMap = map;
      break;
    }
  }

  if (!columnMap) {
    return [];
  }

  const customerRows = [];
  rows.slice(headerIndex + 1).forEach((row) => {
    const customerName = String(getCell(row, columnMap.customerName) || "").trim();
    if (!customerName) {
      return;
    }

    const quantity = toNumberOrZero(getCell(row, columnMap.quantity));
    const itemTotal = toNumberOrZero(getCell(row, columnMap.itemTotal));
    const subTotal = toNumberOrZero(getCell(row, columnMap.subTotal));
    const total = toNumberOrZero(getCell(row, columnMap.total));
    const balance = toNumberOrZero(getCell(row, columnMap.balance));
    const hasAtLeastOneAmount =
      Number.isFinite(quantity) ||
      Number.isFinite(itemTotal) ||
      Number.isFinite(subTotal) ||
      Number.isFinite(total) ||
      Number.isFinite(balance);

    if (!hasAtLeastOneAmount) {
      return;
    }

    customerRows.push({
      customerName,
      quantity: Number(quantity || 0),
      itemTotal: Number(itemTotal || 0),
      subTotal: Number(subTotal || 0),
      total: Number(total || 0),
      balance: Number(balance || 0),
    });
  });

  return customerRows;
};

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
  const customerRows = [];

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
      const extractedCustomerRows = parseRetailCustomerRows(rows);
      extractedCustomerRows.forEach((entry) => customerRows.push(entry));
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

    const extractedCustomerRows = parseRetailCustomerRows(rows);
    extractedCustomerRows.forEach((entry) => customerRows.push(entry));
  });

  const customerRowsTotal = customerRows.reduce(
    (sum, row) => sum + Number(row?.total || 0),
    0,
  );
  if (customerRows.length > 0) {
    revenue = customerRowsTotal;
    revenueFound = true;
  }

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
        retailCustomerRows: customerRows.length > 0,
      },
      warnings,
      customerRows,
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
                          retailCustomerRows: Boolean(
                            entry.parseInsights.fieldsDetected.retailCustomerRows,
                          ),
                        }
                      : null,
                  customerRows: Array.isArray(entry.parseInsights.customerRows)
                    ? entry.parseInsights.customerRows
                        .map((customerRow) => ({
                          customerName: String(customerRow?.customerName || "").trim(),
                          quantity: Number(customerRow?.quantity || 0),
                          itemTotal: Number(customerRow?.itemTotal || 0),
                          subTotal: Number(customerRow?.subTotal || 0),
                          total: Number(customerRow?.total || 0),
                          balance: Number(customerRow?.balance || 0),
                        }))
                        .filter((customerRow) => customerRow.customerName)
                    : [],
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
                    retailCustomerRows: Boolean(
                      parseInsights.fieldsDetected.retailCustomerRows,
                    ),
                  }
                : null,
            customerRows: Array.isArray(parseInsights.customerRows)
              ? parseInsights.customerRows
                  .map((customerRow) => ({
                    customerName: String(customerRow?.customerName || "").trim(),
                    quantity: Number(customerRow?.quantity || 0),
                    itemTotal: Number(customerRow?.itemTotal || 0),
                    subTotal: Number(customerRow?.subTotal || 0),
                    total: Number(customerRow?.total || 0),
                    balance: Number(customerRow?.balance || 0),
                  }))
                  .filter((customerRow) => customerRow.customerName)
              : [],
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

const deleteRetailProfitEntry = async (entryId) => {
  const normalizedId = String(entryId || "").trim();
  if (!normalizedId) {
    return { removed: null, tracker: await getRetailProfitTracker() };
  }

  const current = await getRetailProfitTracker();
  const entries = Array.isArray(current?.entries) ? current.entries : [];
  const removed = entries.find((entry) => String(entry?.id || "") === normalizedId) || null;
  if (!removed) {
    return { removed: null, tracker: current };
  }

  const nextEntries = entries.filter(
    (entry) => String(entry?.id || "") !== normalizedId,
  );
  const tracker = await saveRetailProfitTracker({ entries: nextEntries });
  return { removed, tracker };
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

const buildRetailCustomerSummary = (tracker) => {
  const entries = Array.isArray(tracker?.entries) ? tracker.entries : [];
  const customerMap = new Map();

  entries.forEach((entry) => {
    const customerRows = Array.isArray(entry?.parseInsights?.customerRows)
      ? entry.parseInsights.customerRows
      : [];
    customerRows.forEach((row) => {
      const customerName = String(row?.customerName || "").trim();
      if (!customerName) return;

      const key = customerName.toLowerCase();
      const current = customerMap.get(key) || {
        customerName,
        quantity: 0,
        itemTotal: 0,
        subTotal: 0,
        total: 0,
        balance: 0,
      };

      current.quantity += Number(row?.quantity || 0);
      current.itemTotal += Number(row?.itemTotal || 0);
      current.subTotal += Number(row?.subTotal || 0);
      current.total += Number(row?.total || 0);
      current.balance += Number(row?.balance || 0);
      customerMap.set(key, current);
    });
  });

  return Array.from(customerMap.values())
    .map((row) => ({
      customerName: row.customerName,
      quantity: Number(row.quantity.toFixed(2)),
      itemTotal: Number(row.itemTotal.toFixed(2)),
      subTotal: Number(row.subTotal.toFixed(2)),
      total: Number(row.total.toFixed(2)),
      balance: Number(row.balance.toFixed(2)),
    }))
    .sort((a, b) => a.customerName.localeCompare(b.customerName));
};

module.exports = {
  getRetailProfitTracker,
  addRetailProfitEntry,
  deleteRetailProfitEntry,
  parseRetailProfitFile,
  buildRetailProfitSummary,
  buildRetailCustomerSummary,
  __test__: {
    parseNumericValue,
    extractValuesFromText,
  },
};
