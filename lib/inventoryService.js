const { prisma } = require("../prisma/lib/prisma");
const { readStoreLocations } = require("./storeLocations");
const { sendEmail } = require("./email");

const STOCK_PRIORITY = {
  criticalMax: 0,
  highMax: 5,
};

const LOW_STOCK_ALERT_EMAIL =
  (process.env.LOW_STOCK_ALERT_EMAIL || "").trim() || "info@clubzero.co.za";
const LOW_STOCK_EMAILS_ENABLED_KEY = "low_stock_emails_enabled";

const INVENTORY_HISTORY_SCOPE = {
  WEBSITE_PRODUCT: "WEBSITE_PRODUCT",
  SUPPLIER_CUSTOM_PRODUCT: "SUPPLIER_CUSTOM_PRODUCT",
};

const getStockPriority = (quantity, lowStockThreshold = STOCK_PRIORITY.highMax) => {
  const normalized = Number(quantity || 0);
  const parsedThreshold = Number.parseInt(lowStockThreshold, 10);
  const normalizedThreshold =
    Number.isInteger(parsedThreshold) && parsedThreshold >= 0
      ? parsedThreshold
      : STOCK_PRIORITY.highMax;

  if (normalized <= STOCK_PRIORITY.criticalMax) {
    return {
      key: "CRITICAL",
      label: "Out / Critical",
      badgeClass: "text-bg-danger",
      rank: 3,
    };
  }

  if (normalized <= normalizedThreshold) {
    return {
      key: "HIGH",
      label: "Low / High Priority",
      badgeClass: "text-bg-warning",
      rank: 2,
    };
  }

  return {
    key: "NORMAL",
    label: "Normal",
    badgeClass: "text-bg-success",
    rank: 1,
  };
};

const getAlertSettingKey = (scope, entityId) => `low_stock_alert:${scope}:${entityId}`;

const readAlertPriority = (value) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return (parsed?.priority || "").toString().toUpperCase() || null;
  } catch (_error) {
    return null;
  }
};

const formatAlertTitle = ({ scope, supplierName, itemName }) => {
  if (scope === "WEBSITE") {
    return `Website product: ${itemName}`;
  }
  if (scope === "SUPPLIER_CUSTOM") {
    return `Supplier product: ${supplierName || "Unknown supplier"} - ${itemName}`;
  }
  if (scope === "SUPPLIER_PRODUCT") {
    return `Supplier stock: ${supplierName || "Unknown supplier"} - ${itemName}`;
  }
  return itemName;
};

const getLowStockEmailsEnabled = async () => {
  const setting = await prisma.appSetting.findUnique({
    where: { key: LOW_STOCK_EMAILS_ENABLED_KEY },
    select: { value: true },
  });

  if (!setting) {
    return true;
  }

  return String(setting.value || "").toLowerCase() !== "false";
};

const getActorEmail = (req) =>
  (req?.session?.user?.email || "").toString().trim() || null;

const recordInventoryHistory = async ({
  scope,
  entityId,
  action,
  itemName,
  reason = null,
  supplierName = null,
  previousQuantity = null,
  changeQuantity = null,
  newQuantity = null,
  actorEmail = null,
}) => {
  if (!scope || !Number.isInteger(entityId) || !action || !itemName) {
    return;
  }

  const baseData = {
    scope,
    entityId,
    action,
    itemName,
    supplierName,
    previousQuantity,
    changeQuantity,
    newQuantity,
    actorEmail,
  };

  try {
    await prisma.inventoryHistory.create({
      data: {
        ...baseData,
        reason,
      },
    });
  } catch (error) {
    if (String(error?.message || "").includes("Unknown arg `reason`")) {
      await prisma.inventoryHistory.create({
        data: baseData,
      });
      return;
    }
    throw error;
  }
};

const maybeSendLowStockAlert = async ({
  scope,
  entityId,
  supplierName = null,
  itemName,
  quantity,
  lowStockThreshold = STOCK_PRIORITY.highMax,
}) => {
  if (!entityId || !itemName) {
    return;
  }

  const alertsEnabled = await getLowStockEmailsEnabled();
  if (!alertsEnabled) {
    return;
  }

  const parsedThreshold = Number.parseInt(lowStockThreshold, 10);
  const normalizedThreshold =
    Number.isInteger(parsedThreshold) && parsedThreshold >= 0
      ? parsedThreshold
      : STOCK_PRIORITY.highMax;

  const priority = getStockPriority(quantity, normalizedThreshold);
  const settingKey = getAlertSettingKey(scope, entityId);

  const existing = await prisma.appSetting.findUnique({
    where: { key: settingKey },
    select: { value: true },
  });
  const previousPriority = readAlertPriority(existing?.value) || "NORMAL";

  if (priority.key === "NORMAL") {
    if (existing) {
      await prisma.appSetting.delete({ where: { key: settingKey } });
    }
    return;
  }

  if (previousPriority === priority.key) {
    return;
  }

  const itemLabel = formatAlertTitle({ scope, supplierName, itemName });
  const subject = `Club Zero low stock alert: ${itemName}`;
  const text = [
    "A stock item has reached a priority threshold.",
    `Item: ${itemLabel}`,
    `Current stock: ${Number(quantity || 0)} case(s)`,
    `Priority: ${priority.label}`,
    `Scope: ${scope}`,
  ].join("\n");

  const emailResult = await sendEmail({
    to: LOW_STOCK_ALERT_EMAIL,
    subject,
    text,
  });

  if (emailResult?.sent) {
    const value = JSON.stringify({
      priority: priority.key,
      quantity: Number(quantity || 0),
      lowStockThreshold: normalizedThreshold,
      notifiedAt: new Date().toISOString(),
    });

    await prisma.appSetting.upsert({
      where: { key: settingKey },
      create: { key: settingKey, value },
      update: { value },
    });
  }
};

const syncSuppliersFromLocations = async () => {
  const locations = readStoreLocations();

  for (const location of locations) {
    const supplierName = (location?.name || "").toString().trim();
    if (!supplierName) {
      continue;
    }

    const existingSupplier = await prisma.supplier.findUnique({
      where: { name: supplierName },
      select: { id: true },
    });

    if (!existingSupplier) {
      await prisma.supplier.create({
        data: {
          name: supplierName,
          contactPhone: (location.phone || "").toString().trim() || null,
          notes:
            [(location.city || "").toString().trim(), (location.state || "").toString().trim()]
              .filter(Boolean)
              .join(", ") || null,
        },
      });
    }
  }
};

const buildNormalizedInventoryData = ({ products, suppliers }) => {
  const notifications = [];

  const normalizedProducts = products.map((product) => {
    const stockPriority = getStockPriority(product.websiteStock, product.lowStockThreshold);

    if (product.isActive !== false && stockPriority.rank > 1) {
      notifications.push({
        scope: "Website",
        supplierName: null,
        itemName: product.name,
        quantity: Number(product.websiteStock || 0),
        priority: stockPriority,
      });
    }

    return {
      ...product,
      stockPriority,
    };
  });

  const normalizedSuppliers = suppliers.map((supplier) => {
    const customProducts = (supplier.customProducts || []).map((product) => {
      const stockPriority = getStockPriority(product.quantity, product.lowStockThreshold);

      if (stockPriority.rank > 1) {
        notifications.push({
          scope: "Supplier",
          supplierName: supplier.name,
          itemName: product.name,
          quantity: Number(product.quantity || 0),
          priority: stockPriority,
        });
      }

      return {
        ...product,
        stockPriority,
      };
    });

    const highestPriorityRank = customProducts.reduce(
      (maxRank, product) => Math.max(maxRank, product.stockPriority.rank),
      1,
    );

    const supplierPriority =
      highestPriorityRank === 3
        ? getStockPriority(0)
        : highestPriorityRank === 2
          ? getStockPriority(STOCK_PRIORITY.highMax)
          : getStockPriority(STOCK_PRIORITY.highMax + 1);

    return {
      ...supplier,
      customProducts,
      supplierPriority,
    };
  });

  return {
    normalizedProducts,
    normalizedSuppliers,
    notifications,
  };
};

const buildHistoryMap = (rows, limitPerEntity = 100) =>
  rows.reduce((acc, row) => {
    const key = row.entityId;
    if (!acc[key]) {
      acc[key] = [];
    }
    if (acc[key].length < limitPerEntity) {
      acc[key].push(row);
    }
    return acc;
  }, {});

const fetchInventoryHistoryMaps = async ({
  websiteProductIds,
  supplierCustomProductIds,
  historyFetchLimit = 1200,
  historyPerEntityLimit = 100,
}) => {
  const [websiteHistoryRows, supplierCustomHistoryRows] = await Promise.all([
    websiteProductIds.length
      ? prisma.inventoryHistory.findMany({
          where: {
            scope: INVENTORY_HISTORY_SCOPE.WEBSITE_PRODUCT,
            entityId: { in: websiteProductIds },
          },
          orderBy: { createdAt: "desc" },
          take: historyFetchLimit,
        })
      : Promise.resolve([]),
    supplierCustomProductIds.length
      ? prisma.inventoryHistory.findMany({
          where: {
            scope: INVENTORY_HISTORY_SCOPE.SUPPLIER_CUSTOM_PRODUCT,
            entityId: { in: supplierCustomProductIds },
          },
          orderBy: { createdAt: "desc" },
          take: historyFetchLimit,
        })
      : Promise.resolve([]),
  ]);

  return {
    websiteHistoryByProductId: buildHistoryMap(websiteHistoryRows, historyPerEntityLimit),
    customHistoryByProductId: buildHistoryMap(
      supplierCustomHistoryRows,
      historyPerEntityLimit,
    ),
  };
};

module.exports = {
  STOCK_PRIORITY,
  LOW_STOCK_EMAILS_ENABLED_KEY,
  INVENTORY_HISTORY_SCOPE,
  getStockPriority,
  getAlertSettingKey,
  getLowStockEmailsEnabled,
  getActorEmail,
  recordInventoryHistory,
  maybeSendLowStockAlert,
  syncSuppliersFromLocations,
  buildNormalizedInventoryData,
  fetchInventoryHistoryMaps,
};
