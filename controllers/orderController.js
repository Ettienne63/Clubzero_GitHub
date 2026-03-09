const { prisma } = require("../prisma/lib/prisma");
const AFFILIATE_RATE = 0.05;
const AFFILIATE_STATUS = {
  NONE: "NONE",
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

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

    await tx.cartItem.deleteMany({ where: { userId } });

    return order;
  });

  return res.redirect(`/auth/orders/thank-you/${createdOrder.id}`);
};

exports.getOrderHistory = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const orders = await prisma.order.findMany({
    where: { userId },
    include: {
      orderItems: {
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "desc" },
  });

  return res.render("orders", { orders });
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
    select: { id: true, userId: true, total: true, createdAt: true },
  });

  if (!order || order.userId !== userId) {
    return res.status(404).send("Order not found");
  }

  return res.render("thank-you", { order });
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

  const totalOrders = orders.length;
  const totalSpent = orders.reduce(
    (sum, order) => sum + Number(order.total),
    0,
  );
  const totalProductsOrdered = orders.reduce(
    (sum, order) =>
      sum +
      order.orderItems.reduce((qtySum, item) => qtySum + Number(item.quantity), 0),
    0,
  );

  const affiliateRate = AFFILIATE_RATE;
  const estimatedEarnings = totalSpent * affiliateRate;
  const normalizedOrders = orders.map((order) => {
    const affiliateStatus = getAffiliateStatus(order);
    const commission = Number(order.total) * affiliateRate;

    return {
      ...order,
      affiliateStatus,
      commission,
    };
  });

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

  if (affiliateState.affiliateProgramStatus === AFFILIATE_STATUS.PENDING) {
    return res.redirect(
      "/auth/affiliate/join?success=Your+affiliate+application+is+pending+admin+approval",
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      affiliateProgramStatus: AFFILIATE_STATUS.PENDING,
      affiliateAppliedAt: new Date(),
      affiliateRejectedAt: null,
    },
  });

  if (req.session?.user) {
    req.session.user.isAffiliate = false;
    req.session.user.affiliateProgramStatus = AFFILIATE_STATUS.PENDING;
  }

  return res.redirect(
    `/auth/affiliate/join?success=${encodeURIComponent(
      "Application submitted. Awaiting admin approval.",
    )}`,
  );
};

exports.postAffiliateLeave = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const affiliateState = await getAffiliateUserState(userId);

  if (!affiliateState.exists) {
    return res.redirect("/auth/logout");
  }

  if (affiliateState.affiliateProgramStatus !== AFFILIATE_STATUS.NONE) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        role: "USER",
        affiliateProgramStatus: AFFILIATE_STATUS.NONE,
        affiliateCode: null,
        affiliateAppliedAt: null,
        affiliateApprovedAt: null,
        affiliateRejectedAt: null,
      },
    });
  }

  if (req.session?.user) {
    req.session.user.role = "USER";
    req.session.user.isAffiliate = false;
    req.session.user.affiliateProgramStatus = AFFILIATE_STATUS.NONE;
    req.session.user.affiliateCode = null;
  }

  return res.redirect(
    `/auth/affiliate/join?success=${encodeURIComponent(
      "You have left the affiliate program.",
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
  const statusFilter = (req.query.status || "all").toString().toLowerCase();
  const allowedFilters = new Set(["all", "pending", "approved", "paid"]);
  const activeStatusFilter = allowedFilters.has(statusFilter) ? statusFilter : "all";

  const applicants = await prisma.user.findMany({
    where: {
      affiliateProgramStatus: {
        in: [AFFILIATE_STATUS.PENDING, AFFILIATE_STATUS.REJECTED],
      },
    },
    orderBy: [{ affiliateAppliedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      name: true,
      email: true,
      affiliateProgramStatus: true,
      affiliateAppliedAt: true,
      affiliateRejectedAt: true,
    },
  });

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

  const filteredOrders =
    activeStatusFilter === "all"
      ? normalizedOrders
      : normalizedOrders.filter(
          (order) => order.affiliateStatus === activeStatusFilter,
        );

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
    applicants,
    orders: filteredOrders,
    summary,
    activeStatusFilter,
    affiliateRate: AFFILIATE_RATE,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.approveAffiliateApplicant = async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/admin/affiliate?error=Invalid+user+id");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      affiliateProgramStatus: true,
      affiliateCode: true,
    },
  });

  if (!user) {
    return res.redirect("/admin/affiliate?error=User+not+found");
  }

  if (user.affiliateProgramStatus === AFFILIATE_STATUS.APPROVED) {
    return res.redirect("/admin/affiliate?success=Affiliate+already+approved");
  }

  const affiliateCode =
    user.affiliateCode || (await generateUniqueAffiliateCode(user.name || user.email));

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: "AFFILIATE",
      affiliateProgramStatus: AFFILIATE_STATUS.APPROVED,
      affiliateCode,
      affiliateApprovedAt: new Date(),
      affiliateRejectedAt: null,
    },
  });

  return res.redirect(
    `/admin/affiliate?success=${encodeURIComponent(
      `Affiliate approved (${affiliateCode})`,
    )}`,
  );
};

exports.rejectAffiliateApplicant = async (req, res) => {
  const userId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/admin/affiliate?error=Invalid+user+id");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, affiliateProgramStatus: true },
  });

  if (!user) {
    return res.redirect("/admin/affiliate?error=User+not+found");
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: "USER",
      affiliateProgramStatus: AFFILIATE_STATUS.REJECTED,
      affiliateRejectedAt: new Date(),
      affiliateApprovedAt: null,
      affiliateCode: null,
    },
  });

  return res.redirect("/admin/affiliate?success=Affiliate+application+rejected");
};

exports.approveAffiliatePayout = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(orderId)) {
    return res.redirect("/admin/affiliate?error=Invalid+order+id");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      affiliateStatus: true,
      affiliateApprovedAt: true,
      affiliatePaidAt: true,
      affiliateReferrerUserId: true,
    },
  });

  if (!order) {
    return res.redirect("/admin/affiliate?error=Order+not+found");
  }

  if (!order.affiliateReferrerUserId) {
    return res.redirect("/admin/affiliate?error=Order+has+no+affiliate+referrer");
  }

  const affiliateStatus = getAffiliateStatus(order);

  if (affiliateStatus === "paid") {
    return res.redirect(
      "/admin/affiliate?error=This+order+is+already+marked+as+paid",
    );
  }

  if (affiliateStatus === "approved") {
    return res.redirect(
      "/admin/affiliate?success=This+order+is+already+approved",
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      affiliateStatus: "APPROVED",
      affiliateApprovedAt: order.affiliateApprovedAt || new Date(),
    },
  });

  return res.redirect("/admin/affiliate?success=Affiliate+payout+approved");
};

exports.markAffiliatePayoutPaid = async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(orderId)) {
    return res.redirect("/admin/affiliate?error=Invalid+order+id");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      affiliateStatus: true,
      affiliateApprovedAt: true,
      affiliatePaidAt: true,
      affiliateReferrerUserId: true,
    },
  });

  if (!order) {
    return res.redirect("/admin/affiliate?error=Order+not+found");
  }

  if (!order.affiliateReferrerUserId) {
    return res.redirect("/admin/affiliate?error=Order+has+no+affiliate+referrer");
  }

  const affiliateStatus = getAffiliateStatus(order);

  if (affiliateStatus === "paid") {
    return res.redirect("/admin/affiliate?success=This+order+is+already+paid");
  }

  if (affiliateStatus !== "approved") {
    return res.redirect(
      "/admin/affiliate?error=Approve+the+order+before+marking+as+paid",
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      affiliateStatus: "PAID",
      affiliateApprovedAt: order.affiliateApprovedAt || new Date(),
      affiliatePaidAt: order.affiliatePaidAt || new Date(),
    },
  });

  return res.redirect("/admin/affiliate?success=Affiliate+payout+marked+as+paid");
};
