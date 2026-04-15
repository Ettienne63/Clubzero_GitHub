const { prisma } = require("../prisma/lib/prisma");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../lib/paystack");
const { logger } = require("../lib/logger");
const { renderInvoicePdf } = require("../lib/invoicePdf");
const { getDiscountedPrice } = require("../lib/pricing");
const { getPromoSettings } = require("../lib/promoSettings");
const {
  getDeliveryPricingSettings,
  saveDeliveryPricingSettings,
} = require("../lib/deliveryPricing");
const {
  BOTTLES_PER_CASE,
  parseCustomPackConfig,
  resolveCustomPack,
  getProductAvailableBottles,
  getProductAvailableCases,
  getMixLabPricingFromSettings,
} = require("../lib/customPack");
const {
  getRetailProfitTracker,
  addRetailProfitEntry,
  parseRetailProfitFile,
  buildRetailProfitSummary,
} = require("../lib/retailProfitTracker");
const DEFAULT_AFFILIATE_RATE = 0.05;
const AFFILIATE_RATE_SETTING_KEY = "affiliate_rate";
const AFFILIATE_STATUS = {
  NONE: "NONE",
  APPROVED: "APPROVED",
};
const INVOICE_STATUS = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  PAID: "PAID",
};
const PAYSTACK_CURRENCY = "ZAR";
const DEFAULT_DELIVERY_COUNTRY = "South Africa";
const ALWAYS_PURCHASABLE_PRODUCT_NAME = "TEST";
const isAlwaysPurchasableProduct = (product) =>
  String(product?.name || "").trim().toUpperCase() === ALWAYS_PURCHASABLE_PRODUCT_NAME;

const coerceAffiliateRate = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 0.5) {
    return null;
  }
  return parsed;
};

const getAffiliateRate = async () => {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { key: AFFILIATE_RATE_SETTING_KEY },
      select: { value: true },
    });
    const rate = coerceAffiliateRate(setting?.value);
    return rate ?? DEFAULT_AFFILIATE_RATE;
  } catch (error) {
    logger.warn("affiliate_rate_load_failed", { error: error.message });
    return DEFAULT_AFFILIATE_RATE;
  }
};

const setAffiliateRate = async (rate) => {
  const normalized = coerceAffiliateRate(rate);
  if (normalized === null) {
    throw new Error("Affiliate rate must be between 0% and 50%.");
  }
  return prisma.appSetting.upsert({
    where: { key: AFFILIATE_RATE_SETTING_KEY },
    create: { key: AFFILIATE_RATE_SETTING_KEY, value: String(normalized) },
    update: { value: String(normalized) },
  });
};

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);
const hasAddressBookModel = () => Boolean(prisma.addressBookEntry);
const getEffectiveDiscountPercent = (product, discountsEnabled) =>
  discountsEnabled && product?.discountEnabled !== false
    ? product?.discountPercent
    : 0;

const buildCheckoutFormData = (body = {}) => ({
  selectedAddressId: (body.selectedAddressId || "").toString().trim(),
  affiliateCode: (body.affiliateCode || "").toString().trim().toUpperCase(),
  applyAffiliateCredit: body.applyAffiliateCredit === "on",
  saveAddress: body.saveAddress === "on",
  deliveryName: (body.deliveryName || "").trim(),
  deliveryPhone: (body.deliveryPhone || "").trim(),
  deliveryAddressLine1: (body.deliveryAddressLine1 || "").trim(),
  deliveryAddressLine2: (body.deliveryAddressLine2 || "").trim(),
  deliveryCity: (body.deliveryCity || "").trim(),
  deliveryState: (body.deliveryState || "").trim(),
  deliveryPostalCode: (body.deliveryPostalCode || "").trim(),
  deliveryCountry: (body.deliveryCountry || "").trim(),
});

const PIN_TAG_PATTERN = /\[PIN:([-\d.]+),([-\d.]+)\]\s*$/i;
const extractPinFromAddressLine2 = (value = "") => {
  const source = String(value || "");
  const match = source.match(PIN_TAG_PATTERN);
  if (!match) {
    return { cleanLine2: source.trim(), latitude: "", longitude: "" };
  }

  const lat = Number.parseFloat(match[1]);
  const lng = Number.parseFloat(match[2]);
  const cleanLine2 = source.replace(PIN_TAG_PATTERN, "").trim();
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return {
      cleanLine2,
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
    };
  }
  return { cleanLine2, latitude: "", longitude: "" };
};

const appendPinToAddressLine2 = (line2 = "", latitude = "", longitude = "") => {
  const parsed = extractPinFromAddressLine2(line2);
  const baseLine2 = parsed.cleanLine2;
  const lat = Number.parseFloat(String(latitude || "").trim());
  const lng = Number.parseFloat(String(longitude || "").trim());
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return baseLine2 || null;
  }
  const pinTag = `[PIN:${lat.toFixed(6)},${lng.toFixed(6)}]`;
  return baseLine2 ? `${baseLine2} ${pinTag}` : pinTag;
};

const hasAllRequiredDeliveryFields = (formData) =>
  Boolean(
    formData.deliveryName &&
      formData.deliveryPhone &&
      formData.deliveryAddressLine1 &&
      formData.deliveryCity &&
      formData.deliveryState &&
      formData.deliveryPostalCode &&
      formData.deliveryCountry,
  );

const isTruthy = (value) => {
  if (Array.isArray(value)) {
    return value.some((entry) => isTruthy(entry));
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
};

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));
const UNPAID_ORDER_STATUSES = ["PENDING_PAYMENT", "PAYMENT_FAILED"];

const normalizeCustomPackConfigForSignature = (config) => {
  const entries = Array.isArray(config) ? config : [];
  return entries
    .map((entry) => ({
      productId: Number.parseInt(entry?.productId, 10) || 0,
      productName: String(entry?.productName || "").trim().toLowerCase(),
      bottlesPerPack: Number(entry?.bottlesPerPack || 0),
    }))
    .sort((a, b) => {
      if (a.productId !== b.productId) {
        return a.productId - b.productId;
      }
      if (a.bottlesPerPack !== b.bottlesPerPack) {
        return a.bottlesPerPack - b.bottlesPerPack;
      }
      return a.productName.localeCompare(b.productName);
    });
};

const buildCartItemsSignature = (cartItems = []) =>
  JSON.stringify(
    (cartItems || [])
      .map((item) => ({
        isCustomPack: Boolean(item?.isCustomPack),
        productId: item?.isCustomPack ? null : Number.parseInt(item?.productId, 10) || 0,
        quantity: Number(item?.quantity || 0),
        unitPrice: roundMoney(item?.unitPrice || 0),
        subtotal: roundMoney(item?.subtotal || 0),
        customPackConfig: item?.isCustomPack
          ? normalizeCustomPackConfigForSignature(item?.customPackEntries || [])
          : [],
      }))
      .sort((a, b) => {
        if (a.isCustomPack !== b.isCustomPack) {
          return a.isCustomPack ? 1 : -1;
        }
        if (a.productId !== b.productId) {
          return (a.productId || 0) - (b.productId || 0);
        }
        if (a.quantity !== b.quantity) {
          return a.quantity - b.quantity;
        }
        if (a.subtotal !== b.subtotal) {
          return a.subtotal - b.subtotal;
        }
        return JSON.stringify(a.customPackConfig).localeCompare(
          JSON.stringify(b.customPackConfig),
        );
      }),
  );

const buildOrderItemsSignature = (orderItems = []) =>
  JSON.stringify(
    (orderItems || [])
      .map((item) => ({
        isCustomPack: Boolean(item?.isCustomPack),
        productId: item?.isCustomPack ? null : Number.parseInt(item?.productId, 10) || 0,
        quantity: Number(item?.quantity || 0),
        unitPrice: roundMoney(item?.productPrice || 0),
        subtotal: roundMoney(item?.subtotal || 0),
        customPackConfig: item?.isCustomPack
          ? normalizeCustomPackConfigForSignature(item?.customPackConfig || [])
          : [],
      }))
      .sort((a, b) => {
        if (a.isCustomPack !== b.isCustomPack) {
          return a.isCustomPack ? 1 : -1;
        }
        if (a.productId !== b.productId) {
          return (a.productId || 0) - (b.productId || 0);
        }
        if (a.quantity !== b.quantity) {
          return a.quantity - b.quantity;
        }
        if (a.subtotal !== b.subtotal) {
          return a.subtotal - b.subtotal;
        }
        return JSON.stringify(a.customPackConfig).localeCompare(
          JSON.stringify(b.customPackConfig),
        );
      }),
  );

const buildCheckoutTotals = ({
  productsSubtotal,
  deliveryFee,
  availableAffiliateBalance,
  wantsAffiliateCredit,
}) => {
  const normalizedProductsSubtotal = roundMoney(productsSubtotal);
  const normalizedDeliveryFee = roundMoney(deliveryFee);
  const orderSubtotal = roundMoney(normalizedProductsSubtotal + normalizedDeliveryFee);
  const creditApplied = wantsAffiliateCredit
    ? roundMoney(Math.min(Number(availableAffiliateBalance || 0), orderSubtotal))
    : 0;
  const payableTotal = roundMoney(Math.max(orderSubtotal - creditApplied, 0));

  return {
    productsSubtotal: normalizedProductsSubtotal,
    deliveryFee: normalizedDeliveryFee,
    orderSubtotal,
    creditApplied,
    payableTotal,
  };
};

const getDeliveryBenefit = async (
  userId,
  deliverySettings,
  productsSubtotal = 0,
) => {
  const configuredFee = deliverySettings.enabled
    ? roundMoney(deliverySettings.fixedFee || 0)
    : 0;
  const freeDeliveryThreshold = roundMoney(
    deliverySettings.freeDeliveryThreshold || 0,
  );

  const priorOrderCount = await prisma.order.count({
    where: {
      userId,
      status: { not: "PAYMENT_FAILED" },
    },
  });
  const isFirstOrder = priorOrderCount === 0;
  const isThresholdEligible =
    freeDeliveryThreshold > 0 &&
    roundMoney(productsSubtotal) >= freeDeliveryThreshold;
  const isThresholdFreeDelivery = isThresholdEligible && !isFirstOrder;
  const isFreeDelivery = (isFirstOrder || isThresholdFreeDelivery) && configuredFee > 0;

  return {
    isFirstOrderFreeDelivery: isFirstOrder && configuredFee > 0,
    isThresholdFreeDelivery: isThresholdFreeDelivery && configuredFee > 0,
    freeDeliveryThreshold,
    configuredFee,
    effectiveFee: isFreeDelivery ? 0 : configuredFee,
  };
};

const getCommissionableOrderAmount = (order) =>
  Number(order?.productsSubtotal || order?.total || 0);

const getCartWithTotal = async (
  userId,
  discountsEnabled = false,
  mixLabPricing = null,
) => {
  const cartItemsRaw = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { id: "desc" },
  });
  const customProductIds = new Set();
  cartItemsRaw.forEach((item) => {
    if (!item.isCustomPack) {
      return;
    }
    parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
      customProductIds.add(entry.productId);
    });
  });
  const customProducts = customProductIds.size
    ? await prisma.product.findMany({
        where: { id: { in: Array.from(customProductIds) } },
        select: {
          id: true,
          name: true,
          price: true,
          discountPercent: true,
          discountEnabled: true,
          websiteStock: true,
          looseBottleStock: true,
          isActive: true,
        },
      })
    : [];
  const productsById = new Map(customProducts.map((product) => [product.id, product]));

  const cartItems = cartItemsRaw.map((item) => {
    if (!item.isCustomPack) {
      const unitPrice = getDiscountedPrice(
        Number(item.product?.price || 0),
        getEffectiveDiscountPercent(item.product, discountsEnabled),
      );
      return {
        ...item,
        lineType: "regular",
        displayName: item.product?.name || "Product",
        bottles: Number(item.quantity || 0) * BOTTLES_PER_CASE,
        unitPrice,
        subtotal: unitPrice * Number(item.quantity || 0),
        customPackEntries: [],
      };
    }

    const resolved = resolveCustomPack({
      config: item.customPackConfig,
      productsById,
      quantity: item.quantity,
      discountsEnabled,
      mixLabPricing,
    });

    if (resolved.error) {
      return {
        ...item,
        lineType: "custom",
        displayName: "Custom 12-Pack",
        bottles: Number(item.quantity || 0) * BOTTLES_PER_CASE,
        unitPrice: 0,
        subtotal: 0,
        customPackEntries: [],
        isUnavailable: true,
        unavailableReason: resolved.error,
      };
    }

    return {
      ...item,
      lineType: "custom",
      displayName: resolved.label,
      bottles: Number(item.quantity || 0) * BOTTLES_PER_CASE,
      unitPrice: resolved.perPackPrice,
      subtotal: resolved.totalPrice,
      customPackEntries: resolved.entries,
      isUnavailable: false,
    };
  });

  const total = cartItems.reduce((sum, item) => {
    return sum + Number(item.subtotal || 0);
  }, 0);

  return { cartItems, total, productsById };
};

const buildInvoiceNumber = (order) =>
  `CZ-${new Date(order.createdAt).getFullYear()}-${String(order.id).padStart(6, "0")}`;

const buildInvoiceNotes = () =>
  "Please use your invoice number as the payment reference.";

const getSmtpConfig = () => {
  const host = (process.env.SMTP_HOST || "").trim();
  const port = Number.parseInt(process.env.SMTP_PORT || "", 10);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const user = (process.env.SMTP_USER || "").trim();
  const pass = process.env.SMTP_PASS || "";
  const from =
    (process.env.CONTACT_FROM_EMAIL || "").trim() || "no-reply@clubzero.local";

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    isConfigured: Boolean(host && Number.isInteger(port) && user && pass),
  };
};

const getInternalOrderEmail = () => {
  const preferred = (process.env.ORDER_NOTIFICATION_EMAIL || "").trim();
  if (preferred) {
    return preferred;
  }
  const contactTo = (process.env.CONTACT_TO_EMAIL || "").trim();
  if (contactTo) {
    return contactTo;
  }
  return "";
};

const getPaystackConfig = () => {
  const secretKey = (process.env.PAYSTACK_SECRET_KEY || "").trim();
  return {
    secretKey,
    isConfigured: Boolean(secretKey),
  };
};

const buildPaystackCallbackUrl = (req) => {
  const fromEnv = (process.env.PAYSTACK_CALLBACK_URL || "").trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `${req.protocol}://${req.get("host")}/auth/checkout/paystack`;
};

const createInvoiceRecord = async (tx, order, recipientEmail) =>
  tx.invoice.create({
    data: {
      orderId: order.id,
      invoiceNumber: buildInvoiceNumber(order),
      recipientName: order.deliveryName,
      recipientEmail,
      subtotal: Number(order.productsSubtotal || 0) + Number(order.deliveryFee || 0),
      total: Number(order.total),
      notes: buildInvoiceNotes(),
    },
  });

const buildInvoiceUrl = (req, orderId) =>
  `${req.protocol}://${req.get("host")}/auth/orders/${orderId}/invoice`;

const sendInvoiceEmail = async ({ invoice, order, req }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
    return false;
  }
  const invoiceStatus = getInvoiceStatusBadge(invoice);

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  const invoiceUrl = req ? buildInvoiceUrl(req, order.id) : "";
  const pdfBuffer = await renderInvoicePdf({
    invoice: {
      ...invoice,
      status: invoiceStatus,
    },
    order,
  });

  const result = await transporter.sendMail({
    from: smtp.from,
    to: invoice.recipientEmail,
    subject: `Payment receipt ${invoice.invoiceNumber} for Club Zero order #${order.id}`,
    text: [
      `Hi ${invoice.recipientName},`,
      "",
      `Thanks for your order. Your payment for order #${order.id} was received successfully.`,
      `Total paid: R${Number(invoice.total).toFixed(2)}`,
      "",
      invoiceUrl ? `View invoice: ${invoiceUrl}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });

  return {
    accepted: result.accepted || [],
    rejected: result.rejected || [],
    response: result.response || null,
  };
};

const sendInvoiceForOrder = async ({ invoice, order, req }) => {
  try {
    const sent = await sendInvoiceEmail({ invoice, order, req });

    if (sent) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status:
            getInvoiceStatusBadge(invoice) === INVOICE_STATUS.PAID
              ? INVOICE_STATUS.PAID
              : INVOICE_STATUS.SENT,
          sentAt: new Date(),
        },
      });
      if (req?.session) {
        req.session.lastOrderInvoiceNotice = {
          orderId: order.id,
          kind: "success",
          message: `Invoice ${invoice.invoiceNumber} was emailed to ${invoice.recipientEmail}.`,
        };
      }
      logger.info("invoice_email_sent", {
        orderId: order.id,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        accepted: sent.accepted,
        rejected: sent.rejected,
        response: sent.response,
      });
    }
  } catch (error) {
    logger.warn("invoice_email_failed", {
      orderId: order.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      error: error.message,
      code: error.code || null,
      command: error.command || null,
      response: error.response || null,
      responseCode: error.responseCode || null,
    });
    if (req?.session) {
      req.session.lastOrderInvoiceNotice = {
        orderId: order.id,
        kind: "warning",
        message:
          "Your invoice was created, but it could not be emailed right now. You can still view or download it below.",
      };
    }
  }
};

const getOrderItemBreakdownLabel = (item) => {
  if (!item?.isCustomPack) {
    return "";
  }
  const parts = parseCustomPackConfig(item.customPackConfig).map(
    (entry) => `${entry.productName || "Flavour"} ${entry.bottlesPerPack}`,
  );
  return parts.length ? ` (${parts.join(", ")})` : "";
};

const getOrderItemQuantityLabel = (item) => {
  const quantity = Number(item?.quantity || 0);
  const caseLabel = `${quantity} case${quantity === 1 ? "" : "s"}`;
  const bottlesLabel = `${quantity * BOTTLES_PER_CASE} bottles`;
  return `${caseLabel} (${bottlesLabel})`;
};

const getOrderDeliveryCoordinates = (order = {}) => {
  const lat = Number.parseFloat(String(order.deliveryLatitude || "").trim());
  const lng = Number.parseFloat(String(order.deliveryLongitude || "").trim());
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return {
    latitude: lat.toFixed(6),
    longitude: lng.toFixed(6),
  };
};

const buildOrderConfirmationText = (order) => {
  const coords = getOrderDeliveryCoordinates(order);
  const lines = [
    `Hi ${order.deliveryName || order.user?.name || "there"},`,
    "",
    `Thanks for your order #${order.id}. We are getting it ready now.`,
    "",
    "Order summary:",
  ];

  order.orderItems.forEach((item) => {
    lines.push(
      `- ${item.productName}${getOrderItemBreakdownLabel(item)} x ${getOrderItemQuantityLabel(item)} (R${Number(
        item.subtotal,
      ).toFixed(2)})`,
    );
  });

  lines.push(
    "",
    `Total: R${Number(order.total).toFixed(2)}`,
    "",
    "Delivery:",
    `${order.deliveryName || ""}`,
    `${order.deliveryAddressLine1 || ""}`,
    `${order.deliveryAddressLine2 || ""}`.trim(),
    `${order.deliveryCity || ""}, ${order.deliveryState || ""} ${
      order.deliveryPostalCode || ""
    }`,
    `${order.deliveryCountry || ""}`,
    coords ? `Coordinates: ${coords.latitude}, ${coords.longitude}` : "",
    "",
    "You will receive a shipping update once dispatched.",
  );

  return lines.filter(Boolean).join("\n");
};

const buildOrderConfirmationHtml = (order) => {
  const coords = getOrderDeliveryCoordinates(order);
  const itemsHtml = order.orderItems
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0;">
            ${item.productName}
            <div style="font-size:12px;color:#666;">${getOrderItemQuantityLabel(item)}${getOrderItemBreakdownLabel(item)}</div>
          </td>
          <td style="padding:6px 0; text-align:right;">${item.quantity}</td>
          <td style="padding:6px 0; text-align:right;">R${Number(
            item.subtotal,
          ).toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  return `
    <div style="font-family:Arial, sans-serif; color:#1f2a44;">
      <h2 style="margin:0 0 12px;">Thanks for your order</h2>
      <p style="margin:0 0 12px;">Order #${order.id} has been received.</p>
      <h3 style="margin:16px 0 8px;">Order summary</h3>
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px 0;">Item</th>
            <th style="text-align:right; padding:6px 0;">Cases</th>
            <th style="text-align:right; padding:6px 0;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;"><strong>Total:</strong> R${Number(
        order.total,
      ).toFixed(2)}</p>
      <h3 style="margin:16px 0 8px;">Delivery</h3>
      <p style="margin:0;">
        ${order.deliveryName || ""}<br />
        ${order.deliveryAddressLine1 || ""}<br />
        ${order.deliveryAddressLine2 || ""}<br />
        ${order.deliveryCity || ""}, ${order.deliveryState || ""} ${
          order.deliveryPostalCode || ""
        }<br />
        ${order.deliveryCountry || ""}
        ${coords ? `<br />Coordinates: ${coords.latitude}, ${coords.longitude}` : ""}
      </p>
    </div>
  `;
};

const buildInternalOrderText = (order) => {
  const coords = getOrderDeliveryCoordinates(order);
  const lines = [
    `New order received: #${order.id}`,
    "",
    "Customer:",
    `${order.user?.name || ""} ${order.user?.email ? `<${order.user.email}>` : ""}`
      .trim(),
    "",
    "Order summary:",
  ];

  order.orderItems.forEach((item) => {
    lines.push(
      `- ${item.productName}${getOrderItemBreakdownLabel(item)} x ${getOrderItemQuantityLabel(item)} (R${Number(
        item.subtotal,
      ).toFixed(2)})`,
    );
  });

  lines.push(
    "",
    `Total: R${Number(order.total).toFixed(2)}`,
    "",
    "Delivery:",
    `${order.deliveryName || ""}`,
    `${order.deliveryAddressLine1 || ""}`,
    `${order.deliveryAddressLine2 || ""}`.trim(),
    `${order.deliveryCity || ""}, ${order.deliveryState || ""} ${
      order.deliveryPostalCode || ""
    }`,
    `${order.deliveryCountry || ""}`,
    coords ? `Coordinates: ${coords.latitude}, ${coords.longitude}` : "",
  );

  return lines.filter(Boolean).join("\n");
};

const buildInternalOrderHtml = (order) => {
  const coords = getOrderDeliveryCoordinates(order);
  const itemsHtml = order.orderItems
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0;">
            ${item.productName}
            <div style="font-size:12px;color:#666;">${getOrderItemQuantityLabel(item)}${getOrderItemBreakdownLabel(item)}</div>
          </td>
          <td style="padding:6px 0; text-align:right;">${item.quantity}</td>
          <td style="padding:6px 0; text-align:right;">R${Number(
            item.subtotal,
          ).toFixed(2)}</td>
        </tr>`,
    )
    .join("");

  const customerName = order.user?.name || "";
  const customerEmail = order.user?.email || "";

  return `
    <div style="font-family:Arial, sans-serif; color:#1f2a44;">
      <h2 style="margin:0 0 12px;">New order received</h2>
      <p style="margin:0 0 12px;">Order #${order.id}</p>
      <p style="margin:0 0 12px;">
        <strong>Customer:</strong> ${customerName} ${customerEmail ? `&lt;${customerEmail}&gt;` : ""}
      </p>
      <h3 style="margin:16px 0 8px;">Order summary</h3>
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:left; padding:6px 0;">Item</th>
            <th style="text-align:right; padding:6px 0;">Cases</th>
            <th style="text-align:right; padding:6px 0;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;"><strong>Total:</strong> R${Number(
        order.total,
      ).toFixed(2)}</p>
      <h3 style="margin:16px 0 8px;">Delivery</h3>
      <p style="margin:0;">
        ${order.deliveryName || ""}<br />
        ${order.deliveryAddressLine1 || ""}<br />
        ${order.deliveryAddressLine2 || ""}<br />
        ${order.deliveryCity || ""}, ${order.deliveryState || ""} ${
          order.deliveryPostalCode || ""
        }<br />
        ${order.deliveryCountry || ""}
        ${coords ? `<br />Coordinates: ${coords.latitude}, ${coords.longitude}` : ""}
      </p>
    </div>
  `;
};

const sendOrderConfirmationEmail = async ({ order, req }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
    return false;
  }

  const recipient =
    order.user?.email || req?.session?.user?.email || "customer@clubzero.local";

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: smtp.from,
    to: recipient,
    subject: `Order confirmation for Club Zero #${order.id}`,
    text: buildOrderConfirmationText(order),
    html: buildOrderConfirmationHtml(order),
  });

  return true;
};

const sendInternalOrderEmail = async ({ order }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
    return false;
  }

  const to = getInternalOrderEmail();
  if (!to) {
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });

  await transporter.sendMail({
    from: smtp.from,
    to,
    subject: `New Club Zero order #${order.id}`,
    text: buildInternalOrderText(order),
    html: buildInternalOrderHtml(order),
  });

  return true;
};

const getInvoiceStatusBadge = (invoice) =>
  String(invoice?.status || INVOICE_STATUS.DRAFT).toUpperCase();

const hasUnavailableItems = (cartItems) =>
  cartItems.some((item) => {
    if (item.isCustomPack) {
      return Boolean(item.isUnavailable);
    }
    return !item.product?.isActive;
  });

const getInsufficientStockItem = (cartItems) => {
  const demandByProduct = new Map();
  const availabilityByProduct = new Map();
  const labelByProduct = new Map();

  (cartItems || []).forEach((item) => {
    if (item.isCustomPack) {
      (item.customPackEntries || []).forEach((entry) => {
        const productId = Number(entry.productId);
        const demand =
          Number(entry.bottlesPerPack || 0) * Number(item.quantity || 0);
        if (!Number.isInteger(productId) || demand <= 0) {
          return;
        }
        demandByProduct.set(productId, (demandByProduct.get(productId) || 0) + demand);
        availabilityByProduct.set(
          productId,
          Number(entry.availableBottles || 0),
        );
        labelByProduct.set(productId, entry.productName || "Custom pack flavour");
      });
      return;
    }

    const productId = Number(item.productId);
    const demand = Number(item.quantity || 0) * BOTTLES_PER_CASE;
    if (!Number.isInteger(productId) || demand <= 0) {
      return;
    }
    demandByProduct.set(productId, (demandByProduct.get(productId) || 0) + demand);
    availabilityByProduct.set(productId, getProductAvailableBottles(item.product));
    labelByProduct.set(productId, item.product?.name || "Product");
  });

  for (const [productId, demand] of demandByProduct.entries()) {
    const label = String(labelByProduct.get(productId) || "An item")
      .trim()
      .toUpperCase();
    if (label === ALWAYS_PURCHASABLE_PRODUCT_NAME) {
      continue;
    }
    const available = Number(availabilityByProduct.get(productId) || 0);
    if (demand > available) {
      return {
        productName: labelByProduct.get(productId) || "An item",
      };
    }
  }
  return null;
};

const getAddressBookEntries = async (userId) => {
  if (!hasAddressBookModel()) {
    return [];
  }

  const entries = await prisma.addressBookEntry.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });
  return entries.map((entry) => {
    const parsed = extractPinFromAddressLine2(entry.addressLine2 || "");
    return {
      ...entry,
      addressLine2: parsed.cleanLine2 || null,
      latitude: parsed.latitude,
      longitude: parsed.longitude,
    };
  });
};

const getAffiliateUserState = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      affiliateProgramStatus: true,
      affiliateCode: true,
      referredByAffiliateId: true,
      affiliateBalance: true,
      _count: {
        select: {
          referredUsers: true,
          referralClicks: true,
        },
      },
    },
  });

  const role = (user?.role || "").toUpperCase();
  const affiliateProgramStatus = (user?.affiliateProgramStatus || "NONE")
    .toString()
    .toUpperCase();

  return {
    exists: Boolean(user),
    role,
    affiliateProgramStatus,
    affiliateCode: user?.affiliateCode || null,
    referredByAffiliateId: user?.referredByAffiliateId || null,
    affiliateBalance: Number(user?.affiliateBalance || 0),
    referredSignupsCount: user?._count?.referredUsers || 0,
    referralClicksCount: user?._count?.referralClicks || 0,
    isAffiliate: affiliateProgramStatus === AFFILIATE_STATUS.APPROVED,
  };
};

const buildAffiliateCodePrefix = (nameOrEmail = "") => {
  const cleaned = (nameOrEmail || "")
    .toString()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!cleaned) {
    return "CLUB";
  }

  return cleaned.slice(0, 5);
};

const randomAffiliateSuffix = () =>
  Math.random().toString(36).slice(2, 6).toUpperCase();

const generateUniqueAffiliateCode = async (seed) => {
  const prefix = buildAffiliateCodePrefix(seed);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `${prefix}-${randomAffiliateSuffix()}`;
    const existing = await prisma.user.findFirst({
      where: { affiliateCode: code },
      select: { id: true },
    });

    if (!existing) {
      return code;
    }
  }

  return `${prefix}-${Date.now().toString(36).slice(-5).toUpperCase()}`;
};

const addBottleDemand = (map, productId, bottles) => {
  if (!Number.isInteger(productId) || !Number.isFinite(bottles) || bottles <= 0) {
    return;
  }
  map.set(productId, (map.get(productId) || 0) + bottles);
};

const buildBottleDemandFromOrderItems = (orderItems) => {
  const demand = new Map();
  (orderItems || []).forEach((item) => {
    if (!item) {
      return;
    }
    if (item.isCustomPack) {
      parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
        addBottleDemand(
          demand,
          entry.productId,
          Number(entry.bottlesPerPack || 0) * Number(item.quantity || 0),
        );
      });
      return;
    }
    addBottleDemand(
      demand,
      Number(item.productId),
      Number(item.quantity || 0) * BOTTLES_PER_CASE,
    );
  });
  return demand;
};

const decrementProductBottles = async (tx, productId, bottlesToDeduct, label) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, websiteStock: true, looseBottleStock: true },
    });

    if (!current) {
      const stockError = new Error(`${label || "A product"} is unavailable.`);
      stockError.code = "INSUFFICIENT_STOCK";
      throw stockError;
    }

    if (isAlwaysPurchasableProduct(current)) {
      return;
    }

    const availableBottles = getProductAvailableBottles(current);
    if (availableBottles < bottlesToDeduct) {
      const stockError = new Error(`${label || "A product"} is out of stock for this order.`);
      stockError.code = "INSUFFICIENT_STOCK";
      throw stockError;
    }

    const remainingBottles = availableBottles - bottlesToDeduct;
    const nextWebsiteStock = Math.floor(remainingBottles / BOTTLES_PER_CASE);
    const nextLooseBottleStock = remainingBottles % BOTTLES_PER_CASE;
    const updated = await tx.product.updateMany({
      where: {
        id: productId,
        websiteStock: Number(current.websiteStock || 0),
        looseBottleStock: Number(current.looseBottleStock || 0),
      },
      data: {
        websiteStock: nextWebsiteStock,
        looseBottleStock: nextLooseBottleStock,
      },
    });

    if (updated.count > 0) {
      return;
    }
  }

  const stockError = new Error(`${label || "A product"} could not reserve stock right now.`);
  stockError.code = "INSUFFICIENT_STOCK";
  throw stockError;
};

const finalizePaidOrder = async ({
  orderId,
  paidAt = new Date(),
  affiliateRate,
}) =>
  prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        orderItems: {
          orderBy: { id: "asc" },
        },
      },
    });

    if (!order) {
      return null;
    }

    const alreadyPaid = order.status === "PAID";

    if (!alreadyPaid) {
      const bottleDemandByProduct = buildBottleDemandFromOrderItems(order.orderItems);
      const labelsByProduct = new Map();
      order.orderItems.forEach((item) => {
        if (item.isCustomPack) {
          parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
            if (!labelsByProduct.has(entry.productId)) {
              labelsByProduct.set(entry.productId, entry.productName || "Custom pack flavour");
            }
          });
        } else if (Number.isInteger(item.productId) && !labelsByProduct.has(item.productId)) {
          labelsByProduct.set(item.productId, item.productName || "Product");
        }
      });

      for (const [productId, bottles] of bottleDemandByProduct.entries()) {
        await decrementProductBottles(
          tx,
          productId,
          bottles,
          labelsByProduct.get(productId) || "Product",
        );
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });
    }

    let invoice = await tx.invoice.findUnique({
      where: { orderId: order.id },
    });

    if (!invoice) {
      invoice = await createInvoiceRecord(
        tx,
        order,
        order.user?.email || "customer@clubzero.local",
      );
    }

    if (invoice.status !== INVOICE_STATUS.PAID || !invoice.paidAt) {
      invoice = await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: INVOICE_STATUS.PAID,
          paidAt: invoice.paidAt || paidAt,
        },
      });
    }

    await tx.cartItem.deleteMany({ where: { userId: order.userId } });
    await tx.user.update({
      where: { id: order.userId },
      data: {
        lastCartActivityAt: null,
        lastAbandonedCartEmailAt: null,
        abandonedCartEmailCount: 0,
      },
    });

    const appliedAffiliateRate =
      coerceAffiliateRate(order.affiliateRate) ??
      coerceAffiliateRate(affiliateRate) ??
      DEFAULT_AFFILIATE_RATE;

    if (
      Number.isInteger(order.affiliateReferrerUserId) &&
      String(order.affiliateStatus || "").toUpperCase() !== "PAID"
    ) {
      const commission = getCommissionableOrderAmount(order) * appliedAffiliateRate;
      if (Number.isFinite(commission) && commission > 0) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            affiliateStatus: "PAID",
            affiliateApprovedAt: order.affiliateApprovedAt || new Date(),
            affiliatePaidAt: order.affiliatePaidAt || new Date(),
          },
        });
        await tx.user.update({
          where: { id: order.affiliateReferrerUserId },
          data: {
            affiliateBalance: {
              increment: commission,
            },
          },
        });
      }
    }

    return {
      order: { ...order, status: "PAID" },
      invoice,
      alreadyPaid,
    };
  });

const findApprovedAffiliateByCode = async (affiliateCode) => {
  const normalizedCode = (affiliateCode || "").toString().trim().toUpperCase();

  if (!normalizedCode) {
    return null;
  }

  return prisma.user.findFirst({
    where: {
      affiliateCode: normalizedCode,
      affiliateProgramStatus: AFFILIATE_STATUS.APPROVED,
    },
    select: {
      id: true,
      affiliateCode: true,
      affiliateProgramStatus: true,
    },
  });
};

exports.getCheckout = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const promoSettings = await getPromoSettings();
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );
  const mixLabPricing = getMixLabPricingFromSettings(
    promoSettings,
    discountsEnabled,
  );
  const { cartItems, total } = await getCartWithTotal(
    userId,
    discountsEnabled,
    mixLabPricing,
  );
  const savedAddresses = await getAddressBookEntries(userId);

  if (!cartItems.length) {
    return res.redirect("/auth/cart");
  }

  if (hasUnavailableItems(cartItems)) {
    return res.redirect(
      `/auth/cart?error=${encodeURIComponent(
        "Some items are no longer available. Remove them to continue.",
      )}`,
    );
  }

  const insufficientStockItem = getInsufficientStockItem(cartItems);
  if (insufficientStockItem) {
    const label = insufficientStockItem.productName || "An item";
    return res.redirect(
      `/auth/cart?error=${encodeURIComponent(
        `${label} doesn't have enough stock for your quantity. Please reduce it and try again.`,
      )}`,
    );
  }

  const buyer = await prisma.user.findUnique({
    where: { id: userId },
    select: { affiliateBalance: true },
  });
  const affiliateBalance = Number(buyer?.affiliateBalance || 0);
  const deliverySettings = await getDeliveryPricingSettings();
  const deliveryBenefit = await getDeliveryBenefit(
    userId,
    deliverySettings,
    total,
  );
  const checkoutTotals = buildCheckoutTotals({
    productsSubtotal: total,
    deliveryFee: deliveryBenefit.effectiveFee,
    availableAffiliateBalance: affiliateBalance,
    wantsAffiliateCredit: false,
  });

  return res.render("checkout", {
    cartItems,
    total,
    productsSubtotal: checkoutTotals.productsSubtotal,
    deliveryFee: checkoutTotals.deliveryFee,
    orderSubtotal: checkoutTotals.orderSubtotal,
    deliveryPricingEnabled: deliverySettings.enabled,
    firstOrderFreeDelivery: deliveryBenefit.isFirstOrderFreeDelivery,
    thresholdFreeDelivery: deliveryBenefit.isThresholdFreeDelivery,
    freeDeliveryThreshold: deliveryBenefit.freeDeliveryThreshold,
    firstOrderDeliverySavings: deliveryBenefit.configuredFee,
    savedAddresses,
    error: null,
    formData: buildCheckoutFormData({
      affiliateCode: req.session?.refAffiliateCode || "",
    }),
    affiliateBalance,
    creditApplied: checkoutTotals.creditApplied,
    payableTotal: checkoutTotals.payableTotal,
    discountsEnabled,
  });
};

exports.postCheckout = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const promoSettings = await getPromoSettings();
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );
  const mixLabPricing = getMixLabPricingFromSettings(
    promoSettings,
    discountsEnabled,
  );
  const formData = buildCheckoutFormData(req.body);
  const { cartItems, total } = await getCartWithTotal(
    userId,
    discountsEnabled,
    mixLabPricing,
  );
  const savedAddresses = await getAddressBookEntries(userId);
  const deliverySettings = await getDeliveryPricingSettings();
  const deliveryBenefit = await getDeliveryBenefit(
    userId,
    deliverySettings,
    total,
  );
  const selectedAddressId = Number.parseInt(formData.selectedAddressId, 10);

  if (!cartItems.length) {
    return res.redirect("/auth/cart");
  }

  if (hasUnavailableItems(cartItems)) {
    return res.redirect(
      `/auth/cart?error=${encodeURIComponent(
        "Some items are no longer available. Remove them to continue.",
      )}`,
    );
  }

  const insufficientStockItem = getInsufficientStockItem(cartItems);
  if (insufficientStockItem) {
    const label = insufficientStockItem.productName || "An item";
    return res.redirect(
      `/auth/cart?error=${encodeURIComponent(
        `${label} doesn't have enough stock for your quantity. Please reduce it and try again.`,
      )}`,
    );
  }

  const buyer = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      referredByAffiliateId: true,
      affiliateBalance: true,
    },
  });
  const availableAffiliateBalance = Math.max(
    Number(buyer?.affiliateBalance || 0),
    0,
  );
  const wantsAffiliateCredit = Boolean(formData.applyAffiliateCredit);

  if (!hasAllRequiredDeliveryFields(formData) && Number.isInteger(selectedAddressId)) {
    const selectedAddress = savedAddresses.find(
      (address) => address.id === selectedAddressId,
    );

    if (selectedAddress) {
      formData.deliveryName = selectedAddress.recipientName || "";
      formData.deliveryPhone = selectedAddress.phone || "";
      formData.deliveryAddressLine1 = selectedAddress.addressLine1 || "";
      formData.deliveryAddressLine2 = selectedAddress.addressLine2 || "";
      formData.deliveryCity = selectedAddress.city || "";
      formData.deliveryState = selectedAddress.state || "";
      formData.deliveryPostalCode = selectedAddress.postalCode || "";
      formData.deliveryCountry = selectedAddress.country || "";
    }
  }

  if (!hasAllRequiredDeliveryFields(formData)) {
    const checkoutTotals = buildCheckoutTotals({
      productsSubtotal: total,
      deliveryFee: deliveryBenefit.effectiveFee,
      availableAffiliateBalance,
      wantsAffiliateCredit,
    });
    return res.status(400).render("checkout", {
      cartItems,
      total,
      productsSubtotal: checkoutTotals.productsSubtotal,
      deliveryFee: checkoutTotals.deliveryFee,
      orderSubtotal: checkoutTotals.orderSubtotal,
      deliveryPricingEnabled: deliverySettings.enabled,
      firstOrderFreeDelivery: deliveryBenefit.isFirstOrderFreeDelivery,
      thresholdFreeDelivery: deliveryBenefit.isThresholdFreeDelivery,
      freeDeliveryThreshold: deliveryBenefit.freeDeliveryThreshold,
      firstOrderDeliverySavings: deliveryBenefit.configuredFee,
      savedAddresses,
      error: "Please fill in all required delivery fields.",
      formData,
      affiliateBalance: availableAffiliateBalance,
      creditApplied: checkoutTotals.creditApplied,
      payableTotal: checkoutTotals.payableTotal,
      discountsEnabled,
    });
  }

  const checkoutTotals = buildCheckoutTotals({
    productsSubtotal: total,
    deliveryFee: deliveryBenefit.effectiveFee,
    availableAffiliateBalance,
    wantsAffiliateCredit,
  });
  const productsSubtotal = checkoutTotals.productsSubtotal;
  const deliveryFee = checkoutTotals.deliveryFee;
  const orderSubtotal = checkoutTotals.orderSubtotal;
  const creditApplied = checkoutTotals.creditApplied;
  const payableTotal = checkoutTotals.payableTotal;
  const cartItemsSignature = buildCartItemsSignature(cartItems);

  let affiliateReferrerUserId = Number.parseInt(
    req.session?.refAffiliateUserId,
    10,
  );

  if (formData.affiliateCode) {
    const affiliateFromCode = await findApprovedAffiliateByCode(
      formData.affiliateCode,
    );

    if (!affiliateFromCode) {
    return res.status(400).render("checkout", {
      cartItems,
      total,
      productsSubtotal,
      deliveryFee,
      orderSubtotal,
      deliveryPricingEnabled: deliverySettings.enabled,
      firstOrderFreeDelivery: deliveryBenefit.isFirstOrderFreeDelivery,
      thresholdFreeDelivery: deliveryBenefit.isThresholdFreeDelivery,
      freeDeliveryThreshold: deliveryBenefit.freeDeliveryThreshold,
      firstOrderDeliverySavings: deliveryBenefit.configuredFee,
      savedAddresses,
      error: "Affiliate code is invalid or not approved yet.",
      formData,
      affiliateBalance: availableAffiliateBalance,
      creditApplied,
      payableTotal,
      discountsEnabled,
    });
  }

    affiliateReferrerUserId = affiliateFromCode.id;
    formData.affiliateCode = affiliateFromCode.affiliateCode;

    if (req.session) {
      req.session.refAffiliateUserId = affiliateFromCode.id;
      req.session.refAffiliateCode = affiliateFromCode.affiliateCode;
    }
  }

  if (!Number.isInteger(affiliateReferrerUserId)) {
    affiliateReferrerUserId = Number.parseInt(buyer?.referredByAffiliateId, 10);
  }

  if (affiliateReferrerUserId === userId) {
    affiliateReferrerUserId = null;
  }

  let affiliateReferrerCode = null;
  if (Number.isInteger(affiliateReferrerUserId)) {
    const affiliateReferrer = await prisma.user.findUnique({
      where: { id: affiliateReferrerUserId },
      select: {
        id: true,
        affiliateProgramStatus: true,
        affiliateCode: true,
      },
    });

    if (
      !affiliateReferrer ||
      affiliateReferrer.affiliateProgramStatus !== AFFILIATE_STATUS.APPROVED
    ) {
      affiliateReferrerUserId = null;
      affiliateReferrerCode = null;
    } else {
      affiliateReferrerCode = affiliateReferrer.affiliateCode || null;
    }
  }

  const affiliateRate = await getAffiliateRate();
  let reusableOrderId = Number.parseInt(req.session?.pendingOrderId, 10);
  if (!Number.isInteger(reusableOrderId)) {
    reusableOrderId = null;
  }

  if (!Number.isInteger(reusableOrderId)) {
    const recentUnpaidOrders = await prisma.order.findMany({
      where: {
        userId,
        status: { in: UNPAID_ORDER_STATUSES },
      },
      include: {
        orderItems: {
          orderBy: { id: "asc" },
        },
      },
      orderBy: { id: "desc" },
      take: 5,
    });

    const matchingOrder = recentUnpaidOrders.find(
      (order) =>
        roundMoney(order.productsSubtotal) === productsSubtotal &&
        roundMoney(order.deliveryFee) === deliveryFee &&
        roundMoney(order.total) === payableTotal &&
        buildOrderItemsSignature(order.orderItems) === cartItemsSignature,
    );

    if (matchingOrder) {
      reusableOrderId = matchingOrder.id;
    }
  }

  const createdOrder = await prisma.$transaction(async (tx) => {
    const orderItemRows = cartItems.map((item) => ({
      productId: item.isCustomPack ? null : item.productId,
      isCustomPack: Boolean(item.isCustomPack),
      customPackConfig: item.isCustomPack
        ? (item.customPackEntries || []).map((entry) => ({
            productId: entry.productId,
            productName: entry.productName,
            bottlesPerPack: entry.bottlesPerPack,
          }))
        : null,
      productName: item.isCustomPack
        ? item.displayName || "Custom 12-Pack"
        : item.product.name,
      productPrice: item.isCustomPack
        ? Number(item.unitPrice || 0)
        : getDiscountedPrice(
            item.product.price,
            getEffectiveDiscountPercent(item.product, discountsEnabled),
          ),
      quantity: item.quantity,
      subtotal: Number(item.subtotal || 0),
    }));

    const reusableOrder =
      Number.isInteger(reusableOrderId)
        ? await tx.order.findUnique({
            where: { id: reusableOrderId },
            select: {
              id: true,
              userId: true,
              status: true,
              affiliateCreditApplied: true,
            },
          })
        : null;

    const canReuseOrder = Boolean(
      reusableOrder &&
        reusableOrder.userId === userId &&
        UNPAID_ORDER_STATUSES.includes(reusableOrder.status),
    );

    let order = null;
    if (canReuseOrder) {
      const previousCreditApplied = roundMoney(reusableOrder.affiliateCreditApplied || 0);
      const nextCreditApplied = roundMoney(creditApplied);
      const creditDelta = roundMoney(nextCreditApplied - previousCreditApplied);

      if (creditDelta > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            affiliateBalance: {
              decrement: creditDelta,
            },
          },
        });
      } else if (creditDelta < 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            affiliateBalance: {
              increment: Math.abs(creditDelta),
            },
          },
        });
      }

      order = await tx.order.update({
        where: { id: reusableOrder.id },
        data: {
          affiliateReferrerUserId: affiliateReferrerUserId || null,
          affiliateReferrerCode,
          affiliateRate,
          productsSubtotal,
          deliveryFee,
          deliveryDistanceKm: null,
          total: payableTotal,
          status: "PENDING_PAYMENT",
          affiliateCreditApplied: creditApplied,
          deliveryName: formData.deliveryName,
          deliveryPhone: formData.deliveryPhone,
          deliveryAddressLine1: formData.deliveryAddressLine1,
          deliveryAddressLine2: formData.deliveryAddressLine2 || null,
          deliveryCity: formData.deliveryCity,
          deliveryState: formData.deliveryState,
          deliveryPostalCode: formData.deliveryPostalCode,
          deliveryCountry: formData.deliveryCountry,
          deliveryLatitude: null,
          deliveryLongitude: null,
          orderItems: {
            deleteMany: {},
            create: orderItemRows,
          },
        },
        include: {
          orderItems: true,
        },
      });
    } else {
      if (creditApplied > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            affiliateBalance: {
              decrement: creditApplied,
            },
          },
        });
      }

      order = await tx.order.create({
        data: {
          userId,
          affiliateReferrerUserId: affiliateReferrerUserId || null,
          affiliateReferrerCode,
          affiliateRate,
          productsSubtotal,
          deliveryFee,
          deliveryDistanceKm: null,
          total: payableTotal,
          status: "PENDING_PAYMENT",
          affiliateCreditApplied: creditApplied,
          deliveryName: formData.deliveryName,
          deliveryPhone: formData.deliveryPhone,
          deliveryAddressLine1: formData.deliveryAddressLine1,
          deliveryAddressLine2: formData.deliveryAddressLine2 || null,
          deliveryCity: formData.deliveryCity,
          deliveryState: formData.deliveryState,
          deliveryPostalCode: formData.deliveryPostalCode,
          deliveryCountry: formData.deliveryCountry,
          deliveryLatitude: null,
          deliveryLongitude: null,
          orderItems: {
            create: orderItemRows,
          },
        },
        include: {
          orderItems: true,
        },
      });
    }

    if (formData.saveAddress && hasAddressBookModel()) {
      const addressLine2WithPin = appendPinToAddressLine2(
        formData.deliveryAddressLine2 || null,
        null,
        null,
      );
      const existingAddress = await tx.addressBookEntry.findFirst({
        where: {
          userId,
          recipientName: formData.deliveryName,
          phone: formData.deliveryPhone,
          addressLine1: formData.deliveryAddressLine1,
          addressLine2: addressLine2WithPin,
          city: formData.deliveryCity,
          state: formData.deliveryState,
          postalCode: formData.deliveryPostalCode,
          country: formData.deliveryCountry,
        },
        select: { id: true },
      });

      if (!existingAddress) {
        await tx.addressBookEntry.create({
          data: {
            userId,
            label: "Checkout Address",
            recipientName: formData.deliveryName,
            phone: formData.deliveryPhone,
            addressLine1: formData.deliveryAddressLine1,
            addressLine2: addressLine2WithPin,
            city: formData.deliveryCity,
            state: formData.deliveryState,
            postalCode: formData.deliveryPostalCode,
            country: formData.deliveryCountry,
          },
        });
      }
    }

    return order;
  });

  const paystack = getPaystackConfig();
  if (!paystack.isConfigured) {
    if (creditApplied > 0) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            affiliateBalance: {
              increment: creditApplied,
            },
          },
        }),
        prisma.order.update({
          where: { id: createdOrder.id },
          data: {
            affiliateCreditApplied: 0,
            total: orderSubtotal,
            status: "PAYMENT_FAILED",
          },
        }),
      ]);
    } else {
      await prisma.order.update({
        where: { id: createdOrder.id },
        data: { status: "PAYMENT_FAILED" },
      });
    }
    return res.status(500).render("checkout", {
      cartItems,
      total,
      productsSubtotal,
      deliveryFee,
      orderSubtotal,
      deliveryPricingEnabled: deliverySettings.enabled,
      firstOrderFreeDelivery: deliveryBenefit.isFirstOrderFreeDelivery,
      thresholdFreeDelivery: deliveryBenefit.isThresholdFreeDelivery,
      freeDeliveryThreshold: deliveryBenefit.freeDeliveryThreshold,
      firstOrderDeliverySavings: deliveryBenefit.configuredFee,
      savedAddresses,
      error: "Payments are not configured yet. Please try again later.",
      formData,
      affiliateBalance: availableAffiliateBalance,
      creditApplied,
      payableTotal,
      discountsEnabled,
    });
  }

  if (payableTotal <= 0) {
    let finalized = null;
    try {
      const affiliateRate = await getAffiliateRate();
      finalized = await finalizePaidOrder({
        orderId: createdOrder.id,
        paidAt: new Date(),
        affiliateRate,
      });
    } catch (error) {
      if (error.code === "INSUFFICIENT_STOCK") {
        await prisma.order.update({
          where: { id: createdOrder.id },
          data: { status: "PAYMENT_FAILED" },
        });
        return res.redirect(
          `/auth/cart?error=${encodeURIComponent(
            error.message || "One or more products no longer have stock.",
          )}`,
        );
      }
      throw error;
    }

    if (finalized?.invoice) {
      await sendInvoiceForOrder({
        invoice: finalized.invoice,
        order: finalized.order,
        req,
      });
    }

    if (finalized && !finalized.alreadyPaid) {
      try {
        await sendOrderConfirmationEmail({
          order: finalized.order,
          req,
        });
      } catch (error) {
        logger.warn("order_confirmation_email_failed", {
          orderId: finalized.order.id,
          error: error.message,
        });
      }

      try {
        await sendInternalOrderEmail({
          order: finalized.order,
        });
      } catch (error) {
        logger.warn("internal_order_email_failed", {
          orderId: finalized.order.id,
          error: error.message,
        });
      }
    }

    if (req.session) {
      req.session.pendingOrderId = null;
      req.session.paystackReference = null;
    }

    return res.redirect(`/auth/orders/thank-you/${createdOrder.id}`);
  }

  const amount = Math.round(Number(payableTotal) * 100);
  const callbackUrl = buildPaystackCallbackUrl(req);

  try {
    const initResponse = await initializeTransaction({
      secretKey: paystack.secretKey,
      email: buyer?.email || req.session?.user?.email || "customer@clubzero.local",
      amount,
      currency: PAYSTACK_CURRENCY,
      callbackUrl,
      metadata: {
        orderId: createdOrder.id,
        userId,
      },
    });

    if (!initResponse?.status || !initResponse?.data?.authorization_url) {
      throw new Error(initResponse?.message || "Unable to start payment.");
    }

    if (req.session) {
      req.session.pendingOrderId = createdOrder.id;
      req.session.paystackReference = initResponse.data.reference || null;
    }

    return res.redirect(initResponse.data.authorization_url);
  } catch (error) {
    logger.warn("paystack_initialize_failed", {
      orderId: createdOrder.id,
      error: error.message,
    });
    if (creditApplied > 0) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: userId },
          data: {
            affiliateBalance: {
              increment: creditApplied,
            },
          },
        }),
        prisma.order.update({
          where: { id: createdOrder.id },
          data: {
            affiliateCreditApplied: 0,
            total: orderSubtotal,
          },
        }),
      ]);
    }
    await prisma.order.update({
      where: { id: createdOrder.id },
      data: { status: "PAYMENT_FAILED" },
    });
    return res.status(500).render("checkout", {
      cartItems,
      total,
      productsSubtotal,
      deliveryFee,
      orderSubtotal,
      deliveryPricingEnabled: deliverySettings.enabled,
      firstOrderFreeDelivery: deliveryBenefit.isFirstOrderFreeDelivery,
      thresholdFreeDelivery: deliveryBenefit.isThresholdFreeDelivery,
      freeDeliveryThreshold: deliveryBenefit.freeDeliveryThreshold,
      firstOrderDeliverySavings: deliveryBenefit.configuredFee,
      savedAddresses,
      error: "Unable to start payment. Please try again.",
      formData,
      affiliateBalance: availableAffiliateBalance,
      creditApplied,
      payableTotal,
      discountsEnabled,
    });
  }
};

exports.handlePaystackCallback = async (req, res) => {
  const reference = (req.query.reference || "").toString().trim();
  if (!reference) {
    return res.redirect("/auth/cart?error=Payment+reference+missing");
  }

  const paystack = getPaystackConfig();
  if (!paystack.isConfigured) {
    return res.redirect("/auth/cart?error=Payments+are+not+configured");
  }

  try {
    const verification = await verifyTransaction({
      secretKey: paystack.secretKey,
      reference,
    });

    if (!verification?.status || verification?.data?.status !== "success") {
      return res.redirect(
        "/auth/cart?error=Payment+was+not+successful",
      );
    }

    const metadata = verification?.data?.metadata || {};
    const orderId =
      Number.parseInt(metadata.orderId, 10) ||
      Number.parseInt(req.session?.pendingOrderId, 10);

    if (!Number.isInteger(orderId)) {
      return res.redirect("/auth/cart?error=Payment+order+not+found");
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, total: true },
    });

    if (!order) {
      return res.redirect("/auth/cart?error=Order+not+found");
    }

    const expectedAmount = Math.round(Number(order.total) * 100);
    if (
      Number.isFinite(verification?.data?.amount) &&
      Number(verification.data.amount) !== expectedAmount
    ) {
      logger.warn("paystack_amount_mismatch", {
        orderId,
        expectedAmount,
        receivedAmount: verification.data.amount,
        reference,
      });
      return res.redirect("/auth/cart?error=Payment+amount+mismatch");
    }

    const affiliateRate = await getAffiliateRate();
    const finalized = await finalizePaidOrder({
      orderId,
      paidAt: verification?.data?.paid_at
        ? new Date(verification.data.paid_at)
        : new Date(),
      affiliateRate,
    });

    if (!finalized) {
      return res.redirect("/auth/cart?error=Order+not+found");
    }

    if (finalized.invoice) {
      await sendInvoiceForOrder({
        invoice: finalized.invoice,
        order: finalized.order,
        req,
      });
    }

    if (!finalized.alreadyPaid) {
      try {
        await sendOrderConfirmationEmail({
          order: finalized.order,
          req,
        });
      } catch (error) {
        logger.warn("order_confirmation_email_failed", {
          orderId: finalized.order.id,
          error: error.message,
        });
      }

      try {
        await sendInternalOrderEmail({
          order: finalized.order,
        });
      } catch (error) {
        logger.warn("internal_order_email_failed", {
          orderId: finalized.order.id,
          error: error.message,
        });
      }
    }

    if (req.session) {
      req.session.pendingOrderId = null;
      req.session.paystackReference = null;
    }

    return res.redirect(`/auth/orders/thank-you/${finalized.order.id}`);
  } catch (error) {
    if (error.code === "INSUFFICIENT_STOCK") {
      return res.redirect(
        `/auth/cart?error=${encodeURIComponent(
          error.message || "One or more products no longer have stock.",
        )}`,
      );
    }
    logger.warn("paystack_verify_failed", {
      reference,
      error: error.message,
    });
    return res.redirect("/auth/cart?error=Unable+to+verify+payment");
  }
};

exports.handlePaystackWebhook = async (req, res) => {
  const paystack = getPaystackConfig();
  const signature = req.headers["x-paystack-signature"];

  if (!paystack.isConfigured || !signature || !req.body) {
    return res.status(400).send("Invalid webhook");
  }

  const computedSignature = crypto
    .createHmac("sha512", paystack.secretKey)
    .update(req.body)
    .digest("hex");

  if (computedSignature !== signature) {
    return res.status(400).send("Invalid signature");
  }

  let payload = null;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (error) {
    return res.status(400).send("Invalid payload");
  }

  if (payload?.event !== "charge.success") {
    return res.status(200).send("Ignored");
  }

  const metadata = payload?.data?.metadata || {};
  const orderId = Number.parseInt(metadata.orderId, 10);
  if (!Number.isInteger(orderId)) {
    return res.status(200).send("Missing order");
  }

  try {
    const affiliateRate = await getAffiliateRate();
    const finalized = await finalizePaidOrder({
      orderId,
      paidAt: payload?.data?.paid_at
        ? new Date(payload.data.paid_at)
        : new Date(),
      affiliateRate,
    });

    if (finalized?.invoice && !finalized.invoice.sentAt) {
      await sendInvoiceForOrder({
        invoice: finalized.invoice,
        order: finalized.order,
        req: null,
      });
    }

    if (finalized && !finalized.alreadyPaid) {
      await sendOrderConfirmationEmail({
        order: finalized.order,
        req: null,
      });

      try {
        await sendInternalOrderEmail({
          order: finalized.order,
        });
      } catch (error) {
        logger.warn("internal_order_email_failed", {
          orderId: finalized.order.id,
          error: error.message,
        });
      }
    }
  } catch (error) {
    logger.warn("paystack_webhook_failed", {
      orderId,
      error: error.message,
    });
  }

  return res.status(200).send("OK");
};

exports.getOrderHistory = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const orders = await prisma.order.findMany({
    where: { userId },
    include: {
      invoice: true,
      orderItems: {
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "desc" },
  });

  return res.render("orders", {
    orders: orders.map((order) => ({
      ...order,
      invoiceStatus: getInvoiceStatusBadge(order.invoice),
    })),
  });
};

exports.retryPaystackPayment = async (req, res) => {
  const userId = getUserId(req);
  const orderId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(orderId)) {
    return res.redirect("/auth/orders?error=Invalid+order+id");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      total: true,
      status: true,
    },
  });

  if (!order || order.userId !== userId) {
    return res.redirect("/auth/orders?error=Order+not+found");
  }

  if (order.status !== "PAYMENT_FAILED" && order.status !== "PENDING_PAYMENT") {
    return res.redirect("/auth/orders?error=Payment+cannot+be+retried");
  }

  const paystack = getPaystackConfig();
  if (!paystack.isConfigured) {
    return res.redirect("/auth/orders?error=Payments+are+not+configured");
  }

  const amount = Math.round(Number(order.total) * 100);
  const callbackUrl = buildPaystackCallbackUrl(req);

  try {
    const initResponse = await initializeTransaction({
      secretKey: paystack.secretKey,
      email: req.session?.user?.email || "customer@clubzero.local",
      amount,
      currency: PAYSTACK_CURRENCY,
      callbackUrl,
      metadata: {
        orderId: order.id,
        userId,
        retry: true,
      },
    });

    if (!initResponse?.status || !initResponse?.data?.authorization_url) {
      throw new Error(initResponse?.message || "Unable to start payment.");
    }

    if (order.status !== "PENDING_PAYMENT") {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: "PENDING_PAYMENT" },
      });
    }

    if (req.session) {
      req.session.pendingOrderId = order.id;
      req.session.paystackReference = initResponse.data.reference || null;
    }

    return res.redirect(initResponse.data.authorization_url);
  } catch (error) {
    logger.warn("paystack_retry_failed", {
      orderId: order.id,
      error: error.message,
    });
    return res.redirect("/auth/orders?error=Unable+to+restart+payment");
  }
};

exports.getOrderThankYou = async (req, res) => {
  const userId = getUserId(req);
  const orderId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(orderId)) {
    return res.status(400).send("Invalid order id");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      userId: true,
      total: true,
      createdAt: true,
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
        },
      },
    },
  });

  if (!order || order.userId !== userId) {
    return res.status(404).send("Order not found");
  }

  let invoiceNotice = null;
  if (req.session?.lastOrderInvoiceNotice?.orderId === order.id) {
    invoiceNotice = req.session.lastOrderInvoiceNotice;
    delete req.session.lastOrderInvoiceNotice;
  }

  return res.render("thank-you", { order, invoiceNotice });
};

exports.getOrderInvoice = async (req, res) => {
  const userId = getUserId(req);
  const orderId = Number.parseInt(req.params.id, 10);
  const isAdmin = Boolean(req.session?.user?.isAdmin);

  if (!Number.isInteger(userId) && !isAdmin) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(orderId)) {
    return res.status(400).send("Invalid order id");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      invoice: true,
      orderItems: {
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order || !order.invoice || (!isAdmin && order.userId !== userId)) {
    return res.status(404).send("Invoice not found");
  }

  if (req.query.download === "1") {
    const pdfBuffer = await renderInvoicePdf({
      invoice: {
        ...order.invoice,
        status: getInvoiceStatusBadge(order.invoice),
      },
      order,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=\"${order.invoice.invoiceNumber}.pdf\"`,
    );
    return res.send(pdfBuffer);
  }

  return res.render("invoice", {
    order,
    invoice: {
      ...order.invoice,
      status: getInvoiceStatusBadge(order.invoice),
    },
    invoiceUrl: buildInvoiceUrl(req, order.id),
  });
};

exports.redirectAdminInvoicesToPayments = async (_req, res) =>
  res.redirect("/admin/payments");

exports.getAdminAnalyticsPage = async (req, res) => {
  const allowedRanges = new Set(["7", "30", "90", "all"]);
  const rangeParam = String(req.query.days || "30").toLowerCase();
  const rangeKey = allowedRanges.has(rangeParam) ? rangeParam : "30";
  const now = new Date();
  let rangeStart = null;

  if (rangeKey !== "all") {
    const days = Number.parseInt(rangeKey, 10);
    rangeStart = new Date(now);
    rangeStart.setDate(now.getDate() - days);
  }

  const orders = await prisma.order.findMany({
    where: rangeStart ? { createdAt: { gte: rangeStart } } : undefined,
    select: {
      id: true,
      userId: true,
      status: true,
      total: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      orderItems: {
        select: {
          productId: true,
          productName: true,
          quantity: true,
          subtotal: true,
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const paidOrders = orders.filter(
    (order) => String(order.status || "").toUpperCase() === "PAID",
  );
  const totalOrders = orders.length;
  const paidOrdersCount = paidOrders.length;
  const revenue = paidOrders.reduce(
    (sum, order) => sum + Number(order.total || 0),
    0,
  );
  const paymentConversionRate =
    totalOrders > 0 ? (paidOrdersCount / totalOrders) * 100 : 0;

  const productMap = new Map();
  paidOrders.forEach((order) => {
    order.orderItems.forEach((item) => {
      const key = `${item.productId}:${item.productName}`;
      const current = productMap.get(key) || {
        productId: item.productId,
        productName: item.productName || "Product",
        unitsSold: 0,
        revenue: 0,
      };
      current.unitsSold += Number(item.quantity || 0);
      current.revenue += Number(item.subtotal || 0);
      productMap.set(key, current);
    });
  });

  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const customerMap = new Map();
  paidOrders.forEach((order) => {
    const key = Number(order.userId);
    if (!Number.isInteger(key)) {
      return;
    }
    const current = customerMap.get(key) || {
      userId: key,
      name: order.user?.name || "Customer",
      email: order.user?.email || "",
      ordersCount: 0,
      spent: 0,
      lastOrderAt: null,
    };
    current.ordersCount += 1;
    current.spent += Number(order.total || 0);
    if (!current.lastOrderAt || new Date(order.createdAt) > new Date(current.lastOrderAt)) {
      current.lastOrderAt = order.createdAt;
    }
    customerMap.set(key, current);
  });

  const customerStats = Array.from(customerMap.values());
  const totalCustomers = customerStats.length;
  const repeatCustomers = customerStats.filter((customer) => customer.ordersCount >= 2);
  const repeatCustomersCount = repeatCustomers.length;
  const repeatCustomerRate =
    totalCustomers > 0 ? (repeatCustomersCount / totalCustomers) * 100 : 0;
  const topRepeatCustomers = repeatCustomers
    .sort((a, b) => b.ordersCount - a.ordersCount || b.spent - a.spent)
    .slice(0, 10);

  return res.render("admin-analytics", {
    rangeKey,
    summary: {
      revenue,
      totalOrders,
      paidOrdersCount,
      paymentConversionRate,
      totalCustomers,
      repeatCustomersCount,
      repeatCustomerRate,
    },
    topProducts,
    topRepeatCustomers,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.getAdminPaymentsPage = async (req, res) => {
  const statusFilter = (req.query.status || "paid").toString().toUpperCase();
  const allowedStatuses = new Set([
    "PAID",
    "PENDING_PAYMENT",
  ]);
  const activeStatusFilter = allowedStatuses.has(statusFilter)
    ? statusFilter
    : "PAID";

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PENDING_PAYMENT"] },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      orderItems: {
        select: { quantity: true },
      },
      invoice: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const normalizedOrders = orders.map((order) => {
    const itemCount = order.orderItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0,
    );
    return {
      ...order,
      itemCount,
      bottlesCount: itemCount * 12,
      invoiceStatus: order.invoice ? getInvoiceStatusBadge(order.invoice) : null,
    };
  });

  const filteredOrders =
    activeStatusFilter === "PAID"
      ? normalizedOrders.filter((order) => order.status === "PAID")
      : normalizedOrders.filter((order) => order.status === "PENDING_PAYMENT");

  const summary = normalizedOrders.reduce(
    (acc, order) => {
      acc.totalOrders += 1;
      const orderTotal = Number(order.total || 0);
      acc.totalValue += orderTotal;
      if (order.status === "PAID") {
        acc.paidCount += 1;
        acc.paidValue += orderTotal;
      } else if (order.status === "PENDING_PAYMENT") {
        acc.pendingCount += 1;
        acc.pendingValue += orderTotal;
      }
      return acc;
    },
    {
      totalOrders: 0,
      totalValue: 0,
      paidValue: 0,
      pendingValue: 0,
      pendingCount: 0,
      paidCount: 0,
    },
  );

  const retailProfitTracker = await getRetailProfitTracker();
  const retailProfitSummary = buildRetailProfitSummary(retailProfitTracker);

  return res.render("admin-payments", {
    orders: filteredOrders,
    summary,
    retailProfitEntries: retailProfitTracker.entries.slice(0, 20),
    retailProfitSummary,
    activeStatusFilter,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.uploadAdminRetailProfitFile = async (req, res) => {
  const returnTo = "/admin/payments";
  const file = req.file;

  if (!file) {
    return res.redirect(
      `${returnTo}?error=${encodeURIComponent(
        "Please upload a PDF, XLSX, XLS, or CSV file.",
      )}`,
    );
  }

  try {
    const parsed = await parseRetailProfitFile(file);
    const hasRevenue = Number.isFinite(parsed?.revenue);
    const hasProfit = Number.isFinite(parsed?.profit);

    if (!hasRevenue && !hasProfit) {
      return res.redirect(
        `${returnTo}?error=${encodeURIComponent(
          "We could not find revenue or profit values in that file. Please check the document format.",
        )}`,
      );
    }

    await addRetailProfitEntry({
      file,
      revenue: hasRevenue ? Number(parsed.revenue) : null,
      profit: hasProfit ? Number(parsed.profit) : null,
    });

    return res.redirect(
      `${returnTo}?success=${encodeURIComponent(
        "Retail profit file uploaded and values tracked.",
      )}`,
    );
  } catch (error) {
    logger.error("admin_retail_profit_upload_failed", {
      filename: file?.originalname || "",
      error: error.message,
    });
    return res.redirect(
      `${returnTo}?error=${encodeURIComponent(error.message || "Could not process that file.")}`,
    );
  }
};

exports.markAdminOrderPaid = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  const statusFilter = String(req.query.status || "pending").toUpperCase();
  const returnTo = `/admin/payments?status=${encodeURIComponent(
    statusFilter.toLowerCase(),
  )}`;

  if (!Number.isInteger(orderId)) {
    return res.redirect(
      `${returnTo}&error=${encodeURIComponent("Invalid order id.")}`,
    );
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });

  if (!order) {
    return res.redirect(
      `${returnTo}&error=${encodeURIComponent("Order not found.")}`,
    );
  }

  if (order.status !== "PENDING_PAYMENT") {
    return res.redirect(
      `${returnTo}&error=${encodeURIComponent(
        "Only pending payments can be marked as paid.",
      )}`,
    );
  }

  try {
    const affiliateRate = await getAffiliateRate();
    const finalized = await finalizePaidOrder({
      orderId,
      paidAt: new Date(),
      affiliateRate,
    });

    if (!finalized) {
      return res.redirect(
        `${returnTo}&error=${encodeURIComponent("Order not found.")}`,
      );
    }

    if (finalized.invoice) {
      await sendInvoiceForOrder({
        invoice: finalized.invoice,
        order: finalized.order,
        req,
      });
    }

    try {
      await sendOrderConfirmationEmail({
        order: finalized.order,
        req,
      });
    } catch (error) {
      logger.warn("admin_mark_paid_confirmation_email_failed", {
        orderId: finalized.order.id,
        error: error.message,
      });
    }

    try {
      await sendInternalOrderEmail({
        order: finalized.order,
      });
    } catch (error) {
      logger.warn("admin_mark_paid_internal_email_failed", {
        orderId: finalized.order.id,
        error: error.message,
      });
    }

    return res.redirect(
      `${returnTo}&success=${encodeURIComponent(
        `Order #${finalized.order.id} marked as paid and emails sent.`,
      )}`,
    );
  } catch (error) {
    if (error.code === "INSUFFICIENT_STOCK") {
      return res.redirect(
        `${returnTo}&error=${encodeURIComponent(
          error.message || "Unable to mark this order as paid because stock is insufficient.",
        )}`,
      );
    }
    throw error;
  }
};


exports.getAffiliateDashboard = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const affiliateState = await getAffiliateUserState(userId);

  if (!affiliateState.exists) {
    return res.redirect("/auth/logout");
  }

  if (!affiliateState.isAffiliate) {
    return res.redirect("/auth/affiliate/join");
  }

  const orders = await prisma.order.findMany({
    where: { affiliateReferrerUserId: userId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      orderItems: {
        select: {
          quantity: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const affiliateRate = await getAffiliateRate();
  const normalizedOrders = orders.map((order) => {
    const affiliateStatus = getAffiliateStatus(order);
    const orderRate =
      coerceAffiliateRate(order.affiliateRate) ?? affiliateRate;
    const commission = getCommissionableOrderAmount(order) * orderRate;

    return {
      ...order,
      affiliateStatus,
      commission,
    };
  });

  const paidOrders = normalizedOrders.filter(
    (order) => order.affiliateStatus === "paid",
  );
  const totalOrders = paidOrders.length;
  const totalSpent = paidOrders.reduce(
    (sum, order) => sum + Number(order.total),
    0,
  );
  const totalProductsOrdered = paidOrders.reduce(
    (sum, order) =>
      sum +
      order.orderItems.reduce((qtySum, item) => qtySum + Number(item.quantity), 0),
    0,
  );
  const estimatedEarnings = paidOrders.reduce(
    (sum, order) => sum + Number(order.commission || 0),
    0,
  );

  const affiliateSummary = normalizedOrders.reduce(
    (acc, order) => {
      if (order.affiliateStatus === "pending") {
        acc.pendingCount += 1;
        acc.pendingEarnings += order.commission;
      } else if (order.affiliateStatus === "paid") {
        acc.paidCount += 1;
        acc.paidEarnings += order.commission;
      }
      return acc;
    },
    {
      pendingCount: 0,
      pendingEarnings: 0,
      paidCount: 0,
      paidEarnings: 0,
    },
  );

  const referralLink = `${req.protocol}://${req.get("host")}/auth/signup?ref=${encodeURIComponent(
    affiliateState.affiliateCode || "",
  )}`;

  return res.render("affiliate", {
    orders: normalizedOrders,
    success: req.query.success || null,
    error: req.query.error || null,
    affiliateState,
    referralLink,
    stats: {
      totalOrders,
      totalSpent,
      totalProductsOrdered,
      referralClicksCount: affiliateState.referralClicksCount,
      referredSignupsCount: affiliateState.referredSignupsCount,
      availableBalance: affiliateState.affiliateBalance,
      affiliateRate,
      estimatedEarnings,
      ...affiliateSummary,
    },
  });
};

exports.getAffiliateJoinPage = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const affiliateState = await getAffiliateUserState(userId);

  if (!affiliateState.exists) {
    return res.redirect("/auth/logout");
  }

  if (affiliateState.affiliateProgramStatus === AFFILIATE_STATUS.APPROVED) {
    return res.redirect("/auth/affiliate");
  }

  return res.render("affiliate-join", {
    success: req.query.success || null,
    error: req.query.error || null,
    affiliateState,
  });
};

exports.postAffiliateJoin = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const affiliateState = await getAffiliateUserState(userId);

  if (!affiliateState.exists) {
    return res.redirect("/auth/logout");
  }

  if (affiliateState.affiliateProgramStatus === AFFILIATE_STATUS.APPROVED) {
    return res.redirect("/auth/affiliate");
  }

  const affiliateCode =
    affiliateState.affiliateCode ||
    (await generateUniqueAffiliateCode(
      req.session?.user?.name || req.session?.user?.email || "",
    ));

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: "AFFILIATE",
      affiliateProgramStatus: AFFILIATE_STATUS.APPROVED,
      affiliateCode,
      affiliateAppliedAt: new Date(),
      affiliateApprovedAt: new Date(),
      affiliateRejectedAt: null,
    },
  });

  if (req.session?.user) {
    req.session.user.isAffiliate = true;
    req.session.user.affiliateProgramStatus = AFFILIATE_STATUS.APPROVED;
    req.session.user.affiliateCode = affiliateCode;
  }

  return res.redirect(
    `/auth/affiliate?success=${encodeURIComponent(
      "Welcome to the affiliate program. Your referral link is ready.",
    )}`,
  );
};

const getAffiliateStatus = (order) => {
  const rawAffiliateStatus = (order.affiliateStatus || "").toUpperCase();

  if (
    rawAffiliateStatus === "PAID" ||
    rawAffiliateStatus === "APPROVED" ||
    order.status === "AFFILIATE_PAID" ||
    order.status === "AFFILIATE_APPROVED"
  ) {
    return "paid";
  }
  return "pending";
};

exports.getAdminAffiliatePage = async (req, res) => {
  return res.redirect("/admin/affiliate/stats");
};

exports.updateAffiliateRate = async (req, res) => {
  const rawPercent = (req.body.affiliateRatePercent || "").toString().trim();
  const percent = Number.parseFloat(rawPercent);

  if (!Number.isFinite(percent)) {
    return res.redirect(
      `/admin/affiliate/stats?error=${encodeURIComponent(
        "Please enter a valid commission percentage.",
      )}`,
    );
  }

  const rate = percent / 100;

  try {
    await setAffiliateRate(rate);
    return res.redirect(
      `/admin/affiliate/stats?success=${encodeURIComponent(
        "Affiliate commission rate updated.",
      )}`,
    );
  } catch (error) {
    return res.redirect(
      `/admin/affiliate/stats?error=${encodeURIComponent(
        error.message || "Unable to update affiliate rate.",
      )}`,
    );
  }
};

exports.getAdminDeliveryPricingPage = async (req, res) => {
  const deliverySettings = await getDeliveryPricingSettings();
  return res.render("admin-delivery-pricing", {
    success: req.query.success || null,
    error: req.query.error || null,
    formData: {
      enabled: deliverySettings.enabled,
      fixedFee: Number(deliverySettings.fixedFee || 0),
      freeDeliveryThreshold: Number(deliverySettings.freeDeliveryThreshold || 600),
      defaultCountry: DEFAULT_DELIVERY_COUNTRY,
    },
  });
};

exports.updateAdminDeliveryPricing = async (req, res) => {
  const enabled = isTruthy(req.body?.deliveryPricingEnabled);
  const fixedFeeRaw = (req.body?.fixedFee || "").toString().trim();
  const fixedFee = Number.parseFloat(fixedFeeRaw);
  const freeDeliveryThresholdRaw = (req.body?.freeDeliveryThreshold || "")
    .toString()
    .trim();
  const freeDeliveryThreshold = Number.parseFloat(freeDeliveryThresholdRaw);
  if (!Number.isFinite(fixedFee) || fixedFee < 0) {
    return res.redirect(
      `/admin/delivery-pricing?error=${encodeURIComponent("Please enter a valid delivery fee.")}`,
    );
  }
  if (
    !Number.isFinite(freeDeliveryThreshold) ||
    freeDeliveryThreshold < 0
  ) {
    return res.redirect(
      `/admin/delivery-pricing?error=${encodeURIComponent("Please enter a valid free delivery threshold.")}`,
    );
  }

  try {
    await saveDeliveryPricingSettings({
      enabled,
      fixedFee,
      freeDeliveryThreshold,
      defaultCountry: DEFAULT_DELIVERY_COUNTRY,
    });
    return res.redirect(
      `/admin/delivery-pricing?success=${encodeURIComponent(
        `Delivery pricing is now ${enabled ? "enabled" : "disabled"}.`,
      )}`,
    );
  } catch (error) {
    return res.redirect(
      `/admin/delivery-pricing?error=${encodeURIComponent(
        error.message || "Unable to save delivery pricing settings.",
      )}`,
    );
  }
};

exports.toggleAdminDeliveryPricing = async (req, res) => {
  const enabled = isTruthy(req.body?.deliveryPricingEnabled);
  const wantsJson =
    req.xhr || (req.get("Accept") || "").includes("application/json");

  try {
    const current = await getDeliveryPricingSettings();
    const next = await saveDeliveryPricingSettings({
      enabled,
      fixedFee: current.fixedFee,
      freeDeliveryThreshold: current.freeDeliveryThreshold,
      defaultCountry: DEFAULT_DELIVERY_COUNTRY,
    });

    if (wantsJson) {
      return res.json({
        success: true,
        enabled: Boolean(next.enabled),
        message: `Delivery pricing is now ${next.enabled ? "enabled" : "disabled"}.`,
      });
    }

    return res.redirect(
      `/admin/delivery-pricing?success=${encodeURIComponent(
        `Delivery pricing is now ${next.enabled ? "enabled" : "disabled"}.`,
      )}`,
    );
  } catch (error) {
    if (wantsJson) {
      return res.status(400).json({
        success: false,
        message: error.message || "Unable to update delivery pricing toggle.",
      });
    }
    return res.redirect(
      `/admin/delivery-pricing?error=${encodeURIComponent(
        error.message || "Unable to update delivery pricing toggle.",
      )}`,
    );
  }
};

exports.getAdminAffiliateStatsPage = async (req, res) => {
  const affiliateRate = await getAffiliateRate();
  const allowedRanges = new Set(["7", "30", "90", "all"]);
  const rangeParam = String(req.query.days || "30").toLowerCase();
  const rangeKey = allowedRanges.has(rangeParam) ? rangeParam : "30";
  const now = new Date();
  let rangeStart = null;
  if (rangeKey !== "all") {
    const days = Number.parseInt(rangeKey, 10);
    rangeStart = new Date(now);
    rangeStart.setDate(now.getDate() - days);
  }

  const orders = await prisma.order.findMany({
    where: {
      affiliateReferrerUserId: { not: null },
      ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      affiliateReferrer: {
        select: {
          id: true,
          name: true,
          email: true,
          affiliateCode: true,
        },
      },
      orderItems: {
        select: {
          quantity: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const normalizedOrders = orders.map((order) => {
    const affiliateStatus = getAffiliateStatus(order);
    const itemsCount = order.orderItems.reduce(
      (sum, item) => sum + Number(item.quantity),
      0,
    );
    const orderRate =
      coerceAffiliateRate(order.affiliateRate) ?? affiliateRate;
    const commission = getCommissionableOrderAmount(order) * orderRate;

    return {
      ...order,
      affiliateStatus,
      itemsCount,
      commission,
    };
  });

  const summary = normalizedOrders.reduce(
    (acc, order) => {
      acc.totalOrders += 1;
      acc.totalItemsSold += order.itemsCount;
      acc.totalCommission += order.commission;
      if (order.affiliateStatus === "pending") {
        acc.pendingCount += 1;
        acc.pendingCommission += order.commission;
      } else if (order.affiliateStatus === "paid") {
        acc.paidCount += 1;
        acc.paidCommission += order.commission;
      }
      return acc;
    },
    {
      totalOrders: 0,
      totalItemsSold: 0,
      totalCommission: 0,
      pendingCount: 0,
      pendingCommission: 0,
      paidCount: 0,
      paidCommission: 0,
    },
  );

  const [
    totalClicks,
    uniqueSessionsRaw,
    uniqueAffiliatesRaw,
    topLandingPathsRaw,
    topReferrersRaw,
    topAffiliatesRaw,
    affiliateSignups,
  ] = await Promise.all([
    prisma.affiliateReferralClick.count({
      ...(rangeStart ? { where: { createdAt: { gte: rangeStart } } } : {}),
    }),
    prisma.affiliateReferralClick.findMany({
      distinct: ["sessionId"],
      where: {
        sessionId: { not: null },
        ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
      },
      select: { sessionId: true },
    }),
    prisma.affiliateReferralClick.findMany({
      distinct: ["affiliateUserId"],
      where: rangeStart ? { createdAt: { gte: rangeStart } } : undefined,
      select: { affiliateUserId: true },
    }),
    prisma.affiliateReferralClick.groupBy({
      by: ["landingPath"],
      _count: { _all: true },
      where: {
        landingPath: { not: null },
        ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
      },
      orderBy: { _count: { landingPath: "desc" } },
      take: 6,
    }),
    prisma.affiliateReferralClick.groupBy({
      by: ["referrerUrl"],
      _count: { _all: true },
      where: {
        referrerUrl: { not: null },
        ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
      },
      orderBy: { _count: { referrerUrl: "desc" } },
      take: 6,
    }),
    prisma.affiliateReferralClick.groupBy({
      by: ["affiliateUserId"],
      _count: { _all: true },
      where: rangeStart ? { createdAt: { gte: rangeStart } } : undefined,
      orderBy: { _count: { affiliateUserId: "desc" } },
      take: 6,
    }),
    prisma.user.count({
      where: {
        referredByAffiliateId: { not: null },
        ...(rangeStart ? { createdAt: { gte: rangeStart } } : {}),
      },
    }),
  ]);

  const uniqueSessions = uniqueSessionsRaw.length;
  const uniqueAffiliates = uniqueAffiliatesRaw.length;

  const revenueByAffiliate = new Map();
  orders.forEach((order) => {
    if (String(order.status || "").toUpperCase() !== "PAID") {
      return;
    }
    if (!Number.isInteger(order.affiliateReferrerUserId)) {
      return;
    }
    const current = revenueByAffiliate.get(order.affiliateReferrerUserId) || 0;
    revenueByAffiliate.set(
      order.affiliateReferrerUserId,
      current + Number(order.total || 0),
    );
  });

  const topAffiliatesByRevenue = Array.from(revenueByAffiliate.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([affiliateUserId, totalRevenue]) => ({
      affiliateId: affiliateUserId,
      totalRevenue,
    }));
  const affiliateIds = new Set(
    topAffiliatesRaw.map((entry) => entry.affiliateUserId),
  );
  topAffiliatesByRevenue.forEach((entry) => affiliateIds.add(entry.affiliateId));

  const affiliateIdList = Array.from(affiliateIds);
  const affiliates = affiliateIdList.length
    ? await prisma.user.findMany({
        where: { id: { in: affiliateIdList } },
        select: {
          id: true,
          name: true,
          email: true,
          affiliateCode: true,
        },
      })
    : [];
  const affiliateById = new Map(affiliates.map((user) => [user.id, user]));

  const normalizedTopAffiliatesByRevenue = topAffiliatesByRevenue.map((entry) => ({
    affiliate:
      affiliateById.get(entry.affiliateId) || {
        id: entry.affiliateId,
        name: "Unknown",
        email: null,
        affiliateCode: null,
      },
    totalRevenue: entry.totalRevenue,
  }));

  return res.render("admin-affiliate-stats", {
    summary,
    affiliateRate,
    rangeKey,
    clickSummary: {
      totalClicks,
      uniqueSessions,
      uniqueAffiliates,
    },
    affiliateSignups,
    topLandingPaths: topLandingPathsRaw.map((entry) => ({
      path: entry.landingPath,
      count: entry._count._all,
    })),
    topReferrers: topReferrersRaw.map((entry) => ({
      referrer: entry.referrerUrl,
      count: entry._count._all,
    })),
    topAffiliates: topAffiliatesRaw.map((entry) => ({
      affiliate: affiliateById.get(entry.affiliateUserId) || {
        id: entry.affiliateUserId,
        name: "Unknown",
        email: null,
        affiliateCode: null,
      },
      count: entry._count._all,
    })),
    topAffiliatesByRevenue: normalizedTopAffiliatesByRevenue,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};
