const { prisma } = require("../prisma/lib/prisma");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const {
  initializeTransaction,
  verifyTransaction,
} = require("../lib/paystack");
const { logger } = require("../lib/logger");
const { renderInvoicePdf } = require("../lib/invoicePdf");
const AFFILIATE_RATE = 0.05;
const AFFILIATE_STATUS = {
  NONE: "NONE",
  APPROVED: "APPROVED",
};
const INVOICE_STATUS = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  PAID: "PAID",
};
const INVOICE_PAYMENT_TERMS_DAYS = 7;
const PAYSTACK_CURRENCY = "ZAR";

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);
const hasAddressBookModel = () => Boolean(prisma.addressBookEntry);

const buildCheckoutFormData = (body = {}) => ({
  selectedAddressId: (body.selectedAddressId || "").toString().trim(),
  affiliateCode: (body.affiliateCode || "").toString().trim().toUpperCase(),
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

const getCartWithTotal = async (userId) => {
  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { id: "desc" },
  });

  const total = cartItems.reduce(
    (sum, item) => sum + Number(item.product.price) * item.quantity,
    0,
  );

  return { cartItems, total };
};

const addDays = (date, days) => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
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
      subtotal: Number(order.total),
      total: Number(order.total),
      notes: buildInvoiceNotes(),
      dueAt: addDays(order.createdAt, INVOICE_PAYMENT_TERMS_DAYS),
    },
  });

const buildInvoiceUrl = (req, orderId) =>
  `${req.protocol}://${req.get("host")}/auth/orders/${orderId}/invoice`;

const sendInvoiceEmail = async ({ invoice, order, req }) => {
  const smtp = getSmtpConfig();
  if (!smtp.isConfigured) {
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

  const invoiceUrl = buildInvoiceUrl(req, order.id);
  const pdfBuffer = await renderInvoicePdf({
    invoice: {
      ...invoice,
      status: getInvoiceStatusBadge(invoice),
    },
    order,
  });

  const result = await transporter.sendMail({
    from: smtp.from,
    to: invoice.recipientEmail,
    subject: `Invoice ${invoice.invoiceNumber} for Club Zero order #${order.id}`,
    text: [
      `Hi ${invoice.recipientName},`,
      "",
      `Your invoice ${invoice.invoiceNumber} for order #${order.id} is ready.`,
      `Amount due: R${Number(invoice.total).toFixed(2)}`,
      invoice.dueAt ? `Due date: ${new Date(invoice.dueAt).toLocaleDateString()}` : "",
      "",
      `View invoice: ${invoiceUrl}`,
      "",
      invoice.notes || "",
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

const buildOrderConfirmationText = (order) => {
  const lines = [
    `Hi ${order.deliveryName || order.user?.name || "there"},`,
    "",
    `Thanks for your order #${order.id}. We are getting it ready now.`,
    "",
    "Order summary:",
  ];

  order.orderItems.forEach((item) => {
    lines.push(
      `- ${item.productName} x ${item.quantity} case${
        item.quantity === 1 ? "" : "s"
      } (R${Number(item.subtotal).toFixed(2)})`,
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
    "",
    "You will receive a shipping update once dispatched.",
  );

  return lines.filter(Boolean).join("\n");
};

const buildOrderConfirmationHtml = (order) => {
  const itemsHtml = order.orderItems
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 0;">${item.productName}</td>
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

const getInvoiceStatusBadge = (invoice) =>
  String(invoice?.status || INVOICE_STATUS.DRAFT).toUpperCase();

const hasUnavailableItems = (cartItems) =>
  cartItems.some((item) => !item.product?.isActive);

const getAddressBookEntries = async (userId) => {
  if (!hasAddressBookModel()) {
    return [];
  }

  return prisma.addressBookEntry.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
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

const finalizePaidOrder = async ({ orderId, paidAt = new Date() }) =>
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

  const { cartItems, total } = await getCartWithTotal(userId);
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

  return res.render("checkout", {
    cartItems,
    total,
    savedAddresses,
    error: null,
    formData: buildCheckoutFormData({
      affiliateCode: req.session?.refAffiliateCode || "",
    }),
  });
};

exports.postCheckout = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const formData = buildCheckoutFormData(req.body);
  const { cartItems, total } = await getCartWithTotal(userId);
  const savedAddresses = await getAddressBookEntries(userId);
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
    return res.status(400).render("checkout", {
      cartItems,
      total,
      savedAddresses,
      error: "Please fill in all required delivery fields.",
      formData,
    });
  }

  const buyer = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      referredByAffiliateId: true,
    },
  });

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
        savedAddresses,
        error: "Affiliate code is invalid or not approved yet.",
        formData,
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

  const createdOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
        affiliateReferrerUserId: affiliateReferrerUserId || null,
        affiliateReferrerCode,
        total,
        status: "PENDING_PAYMENT",
        deliveryName: formData.deliveryName,
        deliveryPhone: formData.deliveryPhone,
        deliveryAddressLine1: formData.deliveryAddressLine1,
        deliveryAddressLine2: formData.deliveryAddressLine2 || null,
        deliveryCity: formData.deliveryCity,
        deliveryState: formData.deliveryState,
        deliveryPostalCode: formData.deliveryPostalCode,
        deliveryCountry: formData.deliveryCountry,
        orderItems: {
          create: cartItems.map((item) => ({
            productId: item.productId,
            productName: item.product.name,
            productPrice: Number(item.product.price),
            quantity: item.quantity,
            subtotal: Number(item.product.price) * item.quantity,
          })),
        },
      },
      include: {
        orderItems: true,
      },
    });

    if (formData.saveAddress && hasAddressBookModel()) {
      const existingAddress = await tx.addressBookEntry.findFirst({
        where: {
          userId,
          recipientName: formData.deliveryName,
          phone: formData.deliveryPhone,
          addressLine1: formData.deliveryAddressLine1,
          addressLine2: formData.deliveryAddressLine2 || null,
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
            addressLine2: formData.deliveryAddressLine2 || null,
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
    return res.status(500).render("checkout", {
      cartItems,
      total,
      savedAddresses,
      error: "Payments are not configured yet. Please try again later.",
      formData,
    });
  }

  const amount = Math.round(Number(total) * 100);
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
    await prisma.order.update({
      where: { id: createdOrder.id },
      data: { status: "PAYMENT_FAILED" },
    });
    return res.status(500).render("checkout", {
      cartItems,
      total,
      savedAddresses,
      error: "Unable to start payment. Please try again.",
      formData,
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

    const finalized = await finalizePaidOrder({
      orderId,
      paidAt: verification?.data?.paid_at
        ? new Date(verification.data.paid_at)
        : new Date(),
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
    }

    if (req.session) {
      req.session.pendingOrderId = null;
      req.session.paystackReference = null;
    }

    return res.redirect(`/auth/orders/thank-you/${finalized.order.id}`);
  } catch (error) {
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
    const finalized = await finalizePaidOrder({
      orderId,
      paidAt: payload?.data?.paid_at
        ? new Date(payload.data.paid_at)
        : new Date(),
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

exports.getAdminInvoicesPage = async (req, res) => {
  const statusFilter = (req.query.status || "all").toString().trim().toUpperCase();
  const allowedStatuses = new Set([
    "ALL",
    INVOICE_STATUS.DRAFT,
    INVOICE_STATUS.SENT,
    INVOICE_STATUS.PAID,
  ]);
  const activeStatusFilter = allowedStatuses.has(statusFilter)
    ? statusFilter
    : "ALL";

  const invoices = await prisma.invoice.findMany({
    where:
      activeStatusFilter === "ALL"
        ? undefined
        : {
            status: activeStatusFilter,
          },
    include: {
      order: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
          orderItems: {
            select: {
              quantity: true,
            },
          },
        },
      },
    },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
  });

  const summary = invoices.reduce(
    (acc, invoice) => {
      const status = getInvoiceStatusBadge(invoice);
      acc.totalCount += 1;
      acc.totalValue += Number(invoice.total);
      if (status === INVOICE_STATUS.DRAFT) {
        acc.draftCount += 1;
      } else if (status === INVOICE_STATUS.SENT) {
        acc.sentCount += 1;
      } else if (status === INVOICE_STATUS.PAID) {
        acc.paidCount += 1;
      }
      return acc;
    },
    {
      totalCount: 0,
      totalValue: 0,
      draftCount: 0,
      sentCount: 0,
      paidCount: 0,
    },
  );

  return res.render("admin-invoices", {
    invoices: invoices.map((invoice) => ({
      ...invoice,
      status: getInvoiceStatusBadge(invoice),
      itemCount: invoice.order.orderItems.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      ),
    })),
    summary,
    activeStatusFilter,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.getAdminPaymentsPage = async (req, res) => {
  const statusFilter = (req.query.status || "all").toString().toUpperCase();
  const allowedStatuses = new Set([
    "ALL",
    "PENDING_PAYMENT",
    "PAYMENT_FAILED",
    "PAID",
  ]);
  const activeStatusFilter = allowedStatuses.has(statusFilter)
    ? statusFilter
    : "ALL";

  const orders = await prisma.order.findMany({
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
    activeStatusFilter === "ALL"
      ? normalizedOrders
      : normalizedOrders.filter((order) => order.status === activeStatusFilter);

  const summary = normalizedOrders.reduce(
    (acc, order) => {
      acc.totalOrders += 1;
      acc.totalValue += Number(order.total || 0);
      if (order.status === "PAID") {
        acc.paidCount += 1;
      } else if (order.status === "PAYMENT_FAILED") {
        acc.failedCount += 1;
      } else if (order.status === "PENDING_PAYMENT") {
        acc.pendingCount += 1;
      }
      return acc;
    },
    {
      totalOrders: 0,
      totalValue: 0,
      pendingCount: 0,
      failedCount: 0,
      paidCount: 0,
    },
  );

  return res.render("admin-payments", {
    orders: filteredOrders,
    summary,
    activeStatusFilter,
    success: req.query.success || null,
    error: req.query.error || null,
  });
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

  const affiliateRate = AFFILIATE_RATE;
  const normalizedOrders = orders.map((order) => {
    const affiliateStatus = getAffiliateStatus(order);
    const commission = Number(order.total) * affiliateRate;

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
  const estimatedEarnings = totalSpent * affiliateRate;

  const affiliateSummary = normalizedOrders.reduce(
    (acc, order) => {
      if (order.affiliateStatus === "pending") {
        acc.pendingCount += 1;
        acc.pendingEarnings += order.commission;
      } else if (order.affiliateStatus === "approved") {
        acc.approvedCount += 1;
        acc.approvedEarnings += order.commission;
      } else if (order.affiliateStatus === "paid") {
        acc.paidCount += 1;
        acc.paidEarnings += order.commission;
      }
      return acc;
    },
    {
      pendingCount: 0,
      pendingEarnings: 0,
      approvedCount: 0,
      approvedEarnings: 0,
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

  if (rawAffiliateStatus === "PAID" || order.status === "AFFILIATE_PAID") {
    return "paid";
  }
  if (
    rawAffiliateStatus === "APPROVED" ||
    order.status === "AFFILIATE_APPROVED"
  ) {
    return "approved";
  }
  return "pending";
};

exports.getAdminAffiliatePage = async (req, res) => {
  const orders = await prisma.order.findMany({
    where: {
      affiliateReferrerUserId: { not: null },
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
    const commission = Number(order.total) * AFFILIATE_RATE;

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
      } else if (order.affiliateStatus === "approved") {
        acc.approvedCount += 1;
        acc.approvedCommission += order.commission;
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
      approvedCount: 0,
      approvedCommission: 0,
      paidCount: 0,
      paidCommission: 0,
    },
  );

  return res.render("admin-affiliate", {
    summary,
    affiliateRate: AFFILIATE_RATE,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};
