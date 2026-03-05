const { prisma } = require("../prisma/lib/prisma");
const AFFILIATE_RATE = 0.05;

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);
const hasAddressBookModel = () => Boolean(prisma.addressBookEntry);

const buildCheckoutFormData = (body = {}) => ({
  selectedAddressId: (body.selectedAddressId || "").toString().trim(),
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
    formData: buildCheckoutFormData(),
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

  const createdOrder = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId,
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

  const orders = await prisma.order.findMany({
    where: { userId },
    include: {
      orderItems: {
        select: {
          quantity: true,
        },
      },
    },
    orderBy: { id: "desc" },
  });

  const totalOrders = orders.length;
  const totalSpent = orders.reduce((sum, order) => sum + Number(order.total), 0);
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

  return res.render("affiliate", {
    orders: normalizedOrders,
    stats: {
      totalOrders,
      totalSpent,
      totalProductsOrdered,
      affiliateRate,
      estimatedEarnings,
      ...affiliateSummary,
    },
  });
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

  const orders = await prisma.order.findMany({
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
    orders: filteredOrders,
    summary,
    activeStatusFilter,
    affiliateRate: AFFILIATE_RATE,
    success: req.query.success || null,
    error: req.query.error || null,
  });
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
    },
  });

  if (!order) {
    return res.redirect("/admin/affiliate?error=Order+not+found");
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
    },
  });

  if (!order) {
    return res.redirect("/admin/affiliate?error=Order+not+found");
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
