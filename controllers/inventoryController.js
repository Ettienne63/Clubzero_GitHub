const { prisma } = require("../prisma/lib/prisma");
const {
  STOCK_MOVEMENT_REASON_OPTIONS,
  toSafeText,
  parseNonNegativeInt,
  parseMovementReason,
} = require("../lib/inventoryValidators");
const {
  STOCK_PRIORITY,
  LOW_STOCK_EMAILS_ENABLED_KEY,
  INVENTORY_HISTORY_SCOPE,
  getAlertSettingKey,
  getLowStockEmailsEnabled,
  getActorEmail,
  recordInventoryHistory,
  maybeSendLowStockAlert,
  syncSuppliersFromLocations,
  buildNormalizedInventoryData,
  fetchInventoryHistoryMaps,
} = require("../lib/inventoryService");

const redirectInventoryError = (res, message) =>
  res.redirect(`/admin/inventory?error=${encodeURIComponent(message)}`);

const redirectInventorySuccess = (res, message) =>
  res.redirect(`/admin/inventory?success=${encodeURIComponent(message)}`);


exports.getAdminInventoryPage = async (req, res) => {
  try {
    await syncSuppliersFromLocations();
  } catch (_error) {
    // Do not block page rendering if sync fails.
  }

  const [products, suppliers, lowStockEmailsEnabled] = await Promise.all([
    prisma.product.findMany({
      select: {
        id: true,
        name: true,
        websiteStock: true,
        lowStockThreshold: true,
        showStockOnCard: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.supplier.findMany({
      include: {
        customProducts: {
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    getLowStockEmailsEnabled(),
  ]);

  const {
    normalizedProducts,
    normalizedSuppliers,
    notifications,
  } = buildNormalizedInventoryData({ products, suppliers });

  const websiteProductIds = normalizedProducts.map((product) => product.id);
  const supplierCustomProductIds = normalizedSuppliers.flatMap((supplier) =>
    (supplier.customProducts || []).map((product) => product.id),
  );

  const {
    websiteHistoryByProductId,
    customHistoryByProductId,
  } = await fetchInventoryHistoryMaps({
    websiteProductIds,
    supplierCustomProductIds,
  });

  return res.render("admin-inventory", {
    products: normalizedProducts,
    suppliers: normalizedSuppliers,
    notifications,
    websiteHistoryByProductId,
    customHistoryByProductId,
    stockMovementReasonOptions: STOCK_MOVEMENT_REASON_OPTIONS,
    lowStockEmailsEnabled,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateLowStockAlertsSetting = async (req, res) => {
  const enabled = String(req.body.lowStockAlertsEnabled || "").toLowerCase() === "on";

  await prisma.appSetting.upsert({
    where: { key: LOW_STOCK_EMAILS_ENABLED_KEY },
    create: {
      key: LOW_STOCK_EMAILS_ENABLED_KEY,
      value: enabled ? "true" : "false",
    },
    update: { value: enabled ? "true" : "false" },
  });

  return redirectInventorySuccess(
    res,
    enabled ? "Low-stock emails enabled." : "Low-stock emails disabled.",
  );
};

exports.updateProductStockVisibility = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const rawValue = req.body.showStockOnCard;
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];
  const showStockOnCard = values
    .map((value) => String(value || "").toLowerCase())
    .includes("on");

  if (!Number.isInteger(productId)) {
    return redirectInventoryError(res, "Invalid product id.");
  }

  try {
    await prisma.product.update({
      where: { id: productId },
      data: { showStockOnCard },
    });
    return redirectInventorySuccess(
      res,
      showStockOnCard ? "Stock display enabled." : "Stock display hidden.",
    );
  } catch (error) {
    if (error.code === "P2025") {
      return redirectInventoryError(res, "Product not found.");
    }
    return redirectInventoryError(res, "Unable to update stock display.");
  }
};

exports.createSupplier = async (req, res) => {
  const name = toSafeText(req.body.name, 120);
  const contactName = toSafeText(req.body.contactName, 120);
  const contactEmail = toSafeText(req.body.contactEmail, 254);
  const contactPhone = toSafeText(req.body.contactPhone, 40);
  const notes = toSafeText(req.body.notes, 2000);
  const supplierType = String(req.body.supplierType || "")
    .trim()
    .toUpperCase();
  const notesPrefix =
    supplierType === "PRIVATE_NO_LOCATION"
      ? "[Private seller - no store location]"
      : "";
  const normalizedNotes = [notesPrefix, notes].filter(Boolean).join(" ");

  if (!name) {
    return redirectInventoryError(res, "Supplier name is required.");
  }

  try {
    await prisma.supplier.create({
      data: {
        name,
        contactName,
        contactEmail,
        contactPhone,
        notes: normalizedNotes,
      },
    });
    return redirectInventorySuccess(res, "Supplier created.");
  } catch (error) {
    if (error.code === "P2002") {
      return redirectInventoryError(
        res,
        "A supplier with this name already exists.",
      );
    }
    return redirectInventoryError(res, "Unable to create supplier.");
  }
};

exports.updateSupplier = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const name = toSafeText(req.body.name, 120);
  const contactName = toSafeText(req.body.contactName, 120);
  const contactEmail = toSafeText(req.body.contactEmail, 254);
  const contactPhone = toSafeText(req.body.contactPhone, 40);
  const notes = toSafeText(req.body.notes, 2000);
  const privateSellerTag = "[Private seller - no store location]";

  if (!Number.isInteger(supplierId)) {
    return redirectInventoryError(res, "Invalid supplier id.");
  }

  if (!name) {
    return redirectInventoryError(res, "Supplier name is required.");
  }

  try {
    const existingSupplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { notes: true },
    });
    const shouldKeepPrivateTag = String(existingSupplier?.notes || "")
      .toLowerCase()
      .includes(privateSellerTag.toLowerCase());
    const normalizedNotes =
      shouldKeepPrivateTag &&
      !String(notes || "").toLowerCase().includes(privateSellerTag.toLowerCase())
        ? [privateSellerTag, notes].filter(Boolean).join(" ")
        : notes;

    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        name,
        contactName,
        contactEmail,
        contactPhone,
        notes: normalizedNotes,
      },
    });
    return redirectInventorySuccess(res, "Supplier updated.");
  } catch (error) {
    if (error.code === "P2002") {
      return redirectInventoryError(
        res,
        "A supplier with this name already exists.",
      );
    }
    if (error.code === "P2025") {
      return redirectInventoryError(res, "Supplier not found.");
    }
    return redirectInventoryError(res, "Unable to update supplier.");
  }
};

exports.deleteSupplier = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(supplierId)) {
    return redirectInventoryError(res, "Invalid supplier id.");
  }

  try {
    const supplierCustomProducts = await prisma.supplierCustomProduct.findMany({
      where: { supplierId },
      select: { id: true },
    });

    await prisma.supplier.delete({ where: { id: supplierId } });

    const keysToDelete = [
      ...supplierCustomProducts.map((product) =>
        getAlertSettingKey("SUPPLIER_CUSTOM", product.id),
      ),
    ];
    if (keysToDelete.length) {
      await prisma.appSetting.deleteMany({
        where: { key: { in: keysToDelete } },
      });
    }

    return redirectInventorySuccess(res, "Supplier removed.");
  } catch (error) {
    if (error.code === "P2025") {
      return redirectInventoryError(res, "Supplier not found.");
    }
    return redirectInventoryError(res, "Unable to remove supplier.");
  }
};

exports.updateWebsiteStock = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const action = (req.body.action || "").toString().trim().toLowerCase();
  const movementReason = parseMovementReason(req.body.reason);
  const addStock = parseNonNegativeInt(
    typeof req.body.addStock !== "undefined"
      ? req.body.addStock
      : typeof req.body.stockValue !== "undefined"
        ? req.body.stockValue
        : req.body.websiteStock,
  );
  const setStock = parseNonNegativeInt(
    typeof req.body.setStock !== "undefined"
      ? req.body.setStock
      : req.body.stockValue,
  );
  const removeStock = parseNonNegativeInt(
    typeof req.body.removeStock !== "undefined"
      ? req.body.removeStock
      : req.body.stockValue,
  );

  if (!Number.isInteger(productId)) {
    return redirectInventoryError(res, "Invalid product id.");
  }
  if (!movementReason) {
    return redirectInventoryError(res, "Please choose a valid stock movement reason.");
  }

  if (action === "set") {
    if (setStock === null) {
      return redirectInventoryError(
        res,
        "Set stock must be a whole number 0 or greater.",
      );
    }
  } else if (action === "remove") {
    if (removeStock === null) {
      return redirectInventoryError(
        res,
        "Remove stock must be a whole number 0 or greater.",
      );
    }
  } else if (addStock === null) {
    return redirectInventoryError(
      res,
      "Add stock must be a whole number 0 or greater.",
    );
  }

  try {
    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, websiteStock: true },
    });
    if (!existingProduct) {
      return redirectInventoryError(res, "Product not found.");
    }

    const previousQuantity = Number(existingProduct.websiteStock || 0);
    const nextQuantity =
      action === "set"
        ? Number(setStock)
        : action === "remove"
          ? previousQuantity - Number(removeStock)
          : previousQuantity + Number(addStock);

    if (action === "remove" && removeStock > previousQuantity) {
      return redirectInventoryError(
        res,
        `Cannot remove ${removeStock} case(s). Only ${previousQuantity} case(s) available.`,
      );
    }

    const product = await prisma.product.update({
      where: { id: productId },
      data:
        action === "set"
          ? { websiteStock: setStock }
          : action === "remove"
            ? { websiteStock: { decrement: removeStock } }
          : { websiteStock: { increment: addStock } },
      select: { id: true, name: true, websiteStock: true, lowStockThreshold: true },
    });

    await recordInventoryHistory({
      scope: INVENTORY_HISTORY_SCOPE.WEBSITE_PRODUCT,
      entityId: product.id,
      action:
        action === "set"
          ? "SET_STOCK"
          : action === "remove"
            ? "REMOVE_STOCK"
            : "ADD_STOCK",
      itemName: product.name,
      reason: movementReason,
      previousQuantity,
      changeQuantity:
        action === "set"
          ? nextQuantity - previousQuantity
          : action === "remove"
            ? -Number(removeStock)
            : Number(addStock),
      newQuantity: Number(product.websiteStock || 0),
      actorEmail: getActorEmail(req),
    });

    await maybeSendLowStockAlert({
      scope: "WEBSITE",
      entityId: product.id,
      itemName: product.name,
      quantity: product.websiteStock,
      lowStockThreshold: product.lowStockThreshold,
    });
    return redirectInventorySuccess(
      res,
      action === "set"
        ? `Set website stock to ${setStock} case(s).`
        : action === "remove"
          ? `Removed ${removeStock} case(s) from website stock.`
          : `Added ${addStock} case(s) to website stock.`,
    );
  } catch (error) {
    if (error.code === "P2025") {
      return redirectInventoryError(res, "Product not found.");
    }
    return redirectInventoryError(res, "Unable to update website stock.");
  }
};

exports.createSupplierCustomProduct = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const name = toSafeText(req.body.name, 160);
  const notes = toSafeText(req.body.notes, 2000);
  const quantity = parseNonNegativeInt(req.body.quantity);
  const lowStockThresholdRaw = (req.body.lowStockThreshold || "").toString().trim();
  const parsedLowStockThreshold = parseNonNegativeInt(req.body.lowStockThreshold);
  const lowStockThreshold =
    parsedLowStockThreshold === null
      ? STOCK_PRIORITY.highMax
      : parsedLowStockThreshold;

  if (!Number.isInteger(supplierId)) {
    return redirectInventoryError(res, "Invalid supplier id.");
  }
  if (!name) {
    return redirectInventoryError(res, "Custom product name is required.");
  }
  if (quantity === null) {
    return redirectInventoryError(
      res,
      "Custom product stock must be a whole number 0 or greater.",
    );
  }
  if (lowStockThresholdRaw && parsedLowStockThreshold === null) {
    return redirectInventoryError(
      res,
      "Low-stock threshold must be a whole number 0 or greater.",
    );
  }

  try {
    const product = await prisma.supplierCustomProduct.create({
      data: {
        supplierId,
        name,
        quantity,
        lowStockThreshold,
        notes,
      },
    });
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    await recordInventoryHistory({
      scope: INVENTORY_HISTORY_SCOPE.SUPPLIER_CUSTOM_PRODUCT,
      entityId: product.id,
      action: "CREATE",
      itemName: product.name,
      supplierName: supplier?.name || null,
      previousQuantity: 0,
      changeQuantity: Number(product.quantity || 0),
      newQuantity: Number(product.quantity || 0),
      actorEmail: getActorEmail(req),
    });
    await maybeSendLowStockAlert({
      scope: "SUPPLIER_CUSTOM",
      entityId: product.id,
      supplierId,
      supplierName: supplier?.name || null,
      itemName: product.name,
      quantity: product.quantity,
      lowStockThreshold: product.lowStockThreshold,
    });
    return redirectInventorySuccess(res, "Supplier custom product added.");
  } catch (error) {
    if (error.code === "P2002") {
      return redirectInventoryError(
        res,
        "This custom product already exists for the supplier.",
      );
    }
    return redirectInventoryError(res, "Unable to add custom product.");
  }
};

exports.importSupplierCustomProductsFromWebsite = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const rawSelectedIds = req.body.websiteProductIds;
  const selectedProductIds = (Array.isArray(rawSelectedIds)
    ? rawSelectedIds
    : [rawSelectedIds]
  )
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  const quantity = parseNonNegativeInt(req.body.quantity);
  const lowStockThresholdRaw = (req.body.lowStockThreshold || "").toString().trim();
  const parsedLowStockThreshold = parseNonNegativeInt(req.body.lowStockThreshold);
  const lowStockThreshold =
    parsedLowStockThreshold === null
      ? STOCK_PRIORITY.highMax
      : parsedLowStockThreshold;
  const notes = toSafeText(req.body.notes, 2000);

  if (!Number.isInteger(supplierId)) {
    return redirectInventoryError(res, "Invalid supplier id.");
  }
  if (!selectedProductIds.length) {
    return redirectInventoryError(
      res,
      "Please select at least one website product.",
    );
  }
  if (quantity === null) {
    return redirectInventoryError(
      res,
      "Opening stock must be a whole number 0 or greater.",
    );
  }
  if (lowStockThresholdRaw && parsedLowStockThreshold === null) {
    return redirectInventoryError(
      res,
      "Low-stock threshold must be a whole number 0 or greater.",
    );
  }

  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true },
    });
    if (!supplier) {
      return redirectInventoryError(res, "Supplier not found.");
    }

    const websiteProducts = await prisma.product.findMany({
      where: { id: { in: selectedProductIds } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (!websiteProducts.length) {
      return redirectInventoryError(res, "No matching website products found.");
    }

    const existingProducts = await prisma.supplierCustomProduct.findMany({
      where: {
        supplierId,
        name: { in: websiteProducts.map((product) => product.name) },
      },
      select: { name: true },
    });
    const existingNameSet = new Set(existingProducts.map((item) => item.name));

    let addedCount = 0;
    let skippedCount = 0;

    for (const websiteProduct of websiteProducts) {
      if (existingNameSet.has(websiteProduct.name)) {
        skippedCount += 1;
        continue;
      }

      try {
        const createdProduct = await prisma.supplierCustomProduct.create({
          data: {
            supplierId,
            name: websiteProduct.name,
            quantity,
            lowStockThreshold,
            notes,
          },
        });

        await recordInventoryHistory({
          scope: INVENTORY_HISTORY_SCOPE.SUPPLIER_CUSTOM_PRODUCT,
          entityId: createdProduct.id,
          action: "CREATE",
          itemName: createdProduct.name,
          supplierName: supplier.name,
          previousQuantity: 0,
          changeQuantity: Number(createdProduct.quantity || 0),
          newQuantity: Number(createdProduct.quantity || 0),
          actorEmail: getActorEmail(req),
        });

        await maybeSendLowStockAlert({
          scope: "SUPPLIER_CUSTOM",
          entityId: createdProduct.id,
          supplierId,
          supplierName: supplier.name,
          itemName: createdProduct.name,
          quantity: createdProduct.quantity,
          lowStockThreshold: createdProduct.lowStockThreshold,
        });

        addedCount += 1;
      } catch (error) {
        if (error.code === "P2002") {
          skippedCount += 1;
          continue;
        }
        throw error;
      }
    }

    if (!addedCount && skippedCount) {
      return redirectInventorySuccess(
        res,
        `${skippedCount} selected product(s) already exist for this supplier.`,
      );
    }

    return redirectInventorySuccess(
      res,
      `Added ${addedCount} product(s) from website list.${
        skippedCount ? ` ${skippedCount} skipped (already existed).` : ""
      }`,
    );
  } catch (_error) {
    return redirectInventoryError(
      res,
      "Unable to import website products for supplier.",
    );
  }
};

exports.updateSupplierCustomProduct = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const customProductId = Number.parseInt(req.params.customProductId, 10);
  const action = (req.body.action || "").toString().trim().toLowerCase();
  const movementReason = parseMovementReason(req.body.reason);
  const name = toSafeText(req.body.name, 160);
  const notes = toSafeText(req.body.notes, 2000);
  const addQuantity = parseNonNegativeInt(
    typeof req.body.addQuantity !== "undefined"
      ? req.body.addQuantity
      : typeof req.body.stockValue !== "undefined"
        ? req.body.stockValue
      : req.body.quantity,
  );
  const setQuantity = parseNonNegativeInt(
    typeof req.body.setQuantity !== "undefined"
      ? req.body.setQuantity
      : req.body.stockValue,
  );
  const removeQuantity = parseNonNegativeInt(
    typeof req.body.removeQuantity !== "undefined"
      ? req.body.removeQuantity
      : req.body.stockValue,
  );

  if (!Number.isInteger(supplierId) || !Number.isInteger(customProductId)) {
    return redirectInventoryError(res, "Invalid custom product id.");
  }
  if (!movementReason) {
    return redirectInventoryError(res, "Please choose a valid stock movement reason.");
  }
  if (!name) {
    return redirectInventoryError(res, "Custom product name is required.");
  }
  if (action === "set") {
    if (setQuantity === null) {
      return redirectInventoryError(
        res,
        "Set stock must be a whole number 0 or greater.",
      );
    }
  } else if (action === "remove") {
    if (removeQuantity === null) {
      return redirectInventoryError(
        res,
        "Remove stock must be a whole number 0 or greater.",
      );
    }
  } else if (addQuantity === null) {
    return redirectInventoryError(
      res,
      "Add stock must be a whole number 0 or greater.",
    );
  }

  try {
    const existingCustomProduct = await prisma.supplierCustomProduct.findFirst({
      where: {
        id: customProductId,
        supplierId,
      },
      select: { id: true, name: true, quantity: true },
    });
    if (!existingCustomProduct) {
      return redirectInventoryError(res, "Custom product not found.");
    }

    const previousQuantity = Number(existingCustomProduct.quantity || 0);
    const targetQuantity =
      action === "set"
        ? Number(setQuantity)
        : action === "remove"
          ? previousQuantity - Number(removeQuantity)
        : previousQuantity + Number(addQuantity);

    if (action === "remove" && removeQuantity > previousQuantity) {
      return redirectInventoryError(
        res,
        `Cannot remove ${removeQuantity} case(s). Only ${previousQuantity} case(s) available.`,
      );
    }

    const customProduct = await prisma.supplierCustomProduct.update({
      where: { id: customProductId },
      data: {
        name,
        quantity:
          action === "set"
            ? setQuantity
            : action === "remove"
              ? { decrement: removeQuantity }
            : { increment: addQuantity },
        notes,
      },
      select: { id: true, name: true, quantity: true, lowStockThreshold: true },
    });

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });

    await recordInventoryHistory({
      scope: INVENTORY_HISTORY_SCOPE.SUPPLIER_CUSTOM_PRODUCT,
      entityId: customProduct.id,
      action:
        action === "set"
          ? "SET_STOCK"
          : action === "remove"
            ? "REMOVE_STOCK"
            : "ADD_STOCK",
      itemName: customProduct.name,
      reason: movementReason,
      supplierName: supplier?.name || null,
      previousQuantity,
      changeQuantity:
        action === "set"
          ? targetQuantity - previousQuantity
          : action === "remove"
            ? -Number(removeQuantity)
          : Number(addQuantity),
      newQuantity: Number(customProduct.quantity || 0),
      actorEmail: getActorEmail(req),
    });

    await maybeSendLowStockAlert({
      scope: "SUPPLIER_CUSTOM",
      entityId: customProduct.id,
      supplierId,
      supplierName: supplier?.name || null,
      itemName: customProduct.name,
      quantity: customProduct.quantity,
      lowStockThreshold: customProduct.lowStockThreshold,
    });
    return redirectInventorySuccess(
      res,
      action === "set"
        ? `Set supplier custom product stock to ${setQuantity} case(s).`
        : action === "remove"
          ? `Removed ${removeQuantity} case(s) from supplier custom product stock.`
          : `Added ${addQuantity} case(s) to supplier custom product stock.`,
    );
  } catch (error) {
    if (error.code === "P2002") {
      return redirectInventoryError(
        res,
        "This custom product name already exists for the supplier.",
      );
    }
    return redirectInventoryError(res, "Unable to update custom product.");
  }
};

exports.deleteSupplierCustomProduct = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const customProductId = Number.parseInt(req.params.customProductId, 10);

  if (!Number.isInteger(supplierId) || !Number.isInteger(customProductId)) {
    return redirectInventoryError(res, "Invalid custom product id.");
  }

  try {
    const [supplier, customProduct] = await Promise.all([
      prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { name: true },
      }),
      prisma.supplierCustomProduct.findFirst({
        where: { id: customProductId, supplierId },
        select: { id: true, name: true, quantity: true },
      }),
    ]);

    if (!customProduct) {
      return redirectInventoryError(res, "Custom product not found.");
    }

    await prisma.supplierCustomProduct.deleteMany({
      where: {
        id: customProductId,
        supplierId,
      },
    });

    await recordInventoryHistory({
      scope: INVENTORY_HISTORY_SCOPE.SUPPLIER_CUSTOM_PRODUCT,
      entityId: customProductId,
      action: "DELETE",
      itemName: customProduct.name,
      supplierName: supplier?.name || null,
      previousQuantity: Number(customProduct.quantity || 0),
      changeQuantity: -Number(customProduct.quantity || 0),
      newQuantity: 0,
      actorEmail: getActorEmail(req),
    });

    await prisma.appSetting.deleteMany({
      where: { key: getAlertSettingKey("SUPPLIER_CUSTOM", customProductId) },
    });
    return redirectInventorySuccess(res, "Supplier custom product removed.");
  } catch (_error) {
    return redirectInventoryError(res, "Unable to remove custom product.");
  }
};

exports.updateWebsiteLowStockThreshold = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const lowStockThreshold = parseNonNegativeInt(req.body.lowStockThreshold);

  if (!Number.isInteger(productId)) {
    return redirectInventoryError(res, "Invalid product id.");
  }
  if (lowStockThreshold === null) {
    return redirectInventoryError(
      res,
      "Low-stock threshold must be a whole number 0 or greater.",
    );
  }

  try {
    const product = await prisma.product.update({
      where: { id: productId },
      data: { lowStockThreshold },
      select: { id: true, name: true, websiteStock: true, lowStockThreshold: true },
    });

    await maybeSendLowStockAlert({
      scope: "WEBSITE",
      entityId: product.id,
      itemName: product.name,
      quantity: product.websiteStock,
      lowStockThreshold: product.lowStockThreshold,
    });

    return redirectInventorySuccess(
      res,
      `Updated low-stock threshold for ${product.name}.`,
    );
  } catch (error) {
    if (error.code === "P2025") {
      return redirectInventoryError(res, "Product not found.");
    }
    return redirectInventoryError(res, "Unable to update low-stock threshold.");
  }
};

exports.updateSupplierCustomLowStockThreshold = async (req, res) => {
  const supplierId = Number.parseInt(req.params.id, 10);
  const customProductId = Number.parseInt(req.params.customProductId, 10);
  const lowStockThreshold = parseNonNegativeInt(req.body.lowStockThreshold);

  if (!Number.isInteger(supplierId) || !Number.isInteger(customProductId)) {
    return redirectInventoryError(res, "Invalid custom product id.");
  }
  if (lowStockThreshold === null) {
    return redirectInventoryError(
      res,
      "Low-stock threshold must be a whole number 0 or greater.",
    );
  }

  try {
    const existingCustomProduct = await prisma.supplierCustomProduct.findFirst({
      where: { id: customProductId, supplierId },
      select: { id: true, name: true, quantity: true },
    });
    if (!existingCustomProduct) {
      return redirectInventoryError(res, "Custom product not found.");
    }

    const customProduct = await prisma.supplierCustomProduct.update({
      where: { id: customProductId },
      data: { lowStockThreshold },
      select: { id: true, name: true, quantity: true, lowStockThreshold: true },
    });
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });

    await maybeSendLowStockAlert({
      scope: "SUPPLIER_CUSTOM",
      entityId: customProduct.id,
      supplierId,
      supplierName: supplier?.name || null,
      itemName: customProduct.name,
      quantity: customProduct.quantity,
      lowStockThreshold: customProduct.lowStockThreshold,
    });

    return redirectInventorySuccess(
      res,
      `Updated low-stock threshold for ${customProduct.name}.`,
    );
  } catch (_error) {
    return redirectInventoryError(res, "Unable to update low-stock threshold.");
  }
};
