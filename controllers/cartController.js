const { prisma } = require("../prisma/lib/prisma");
const { getDiscountedPrice } = require("../lib/pricing");
const { getPromoSettings } = require("../lib/promoSettings");

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);
const isAjaxRequest = (req) =>
  req.xhr || req.get("X-Requested-With") === "XMLHttpRequest";
const getEffectiveDiscountPercent = (product, discountsEnabled) =>
  discountsEnabled && product?.discountEnabled !== false
    ? product?.discountPercent
    : 0;
const touchCartActivity = async (userId) => {
  if (!Number.isInteger(userId)) {
    return;
  }
  await prisma.user.update({
    where: { id: userId },
    data: {
      lastCartActivityAt: new Date(),
      lastAbandonedCartEmailAt: null,
      abandonedCartEmailCount: 0,
    },
  });
};

exports.getCart = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const [cartItems, promoSettings] = await Promise.all([
    prisma.cartItem.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { id: "desc" },
    }),
    getPromoSettings(),
  ]);
  const discountsEnabled = Boolean(
    promoSettings?.enabled && promoSettings?.discountsEnabled,
  );

  const total = cartItems.reduce((sum, item) => {
    const unitPrice = getDiscountedPrice(
      item.product.price,
      getEffectiveDiscountPercent(item.product, discountsEnabled),
    );
    return sum + unitPrice * item.quantity;
  }, 0);
  const hasUnavailableItems = cartItems.some((item) => !item.product?.isActive);

  return res.render("cart", {
    cartItems,
    total,
    error: req.query.error || null,
    hasUnavailableItems,
    discountsEnabled,
  });
};

exports.addToCart = async (req, res) => {
  const userId = getUserId(req);
  const productId = Number.parseInt(req.body.productId, 10);
  const quantity = Math.max(1, Number.parseInt(req.body.quantity, 10) || 1);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });

  if (!product) {
    return res.redirect(
      `/auth/products?error=${encodeURIComponent(
        "This product is no longer available.",
      )}`,
    );
  }

  await prisma.cartItem.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    create: {
      userId,
      productId,
      quantity,
    },
    update: {
      quantity: { increment: quantity },
    },
  });
  await touchCartActivity(userId);

  return res.redirect("/auth/cart");
};

exports.updateCartItem = async (req, res) => {
  const userId = getUserId(req);
  const itemId = Number.parseInt(req.params.id, 10);
  const quantity = Number.parseInt(req.body.quantity, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(itemId)) {
    return res.status(400).send("Invalid cart item id");
  }

  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, userId: true },
  });

  if (!cartItem || cartItem.userId !== userId) {
    return res.status(404).send("Cart item not found");
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    await prisma.cartItem.delete({ where: { id: itemId } });
    await touchCartActivity(userId);

    if (isAjaxRequest(req)) {
      const [cartItems, promoSettings] = await Promise.all([
        prisma.cartItem.findMany({
          where: { userId },
          include: {
            product: {
              select: { price: true, discountPercent: true, discountEnabled: true },
            },
          },
        }),
        getPromoSettings(),
      ]);
      const discountsEnabled = Boolean(
        promoSettings?.enabled && promoSettings?.discountsEnabled,
      );
      const total = cartItems.reduce((sum, item) => {
        const unitPrice = getDiscountedPrice(
          item.product.price,
          getEffectiveDiscountPercent(item.product, discountsEnabled),
        );
        return sum + unitPrice * item.quantity;
      }, 0);
      const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

      return res.json({
        success: true,
        removed: true,
        itemId,
        total,
        cartCount,
      });
    }

    return res.redirect("/auth/cart");
  }

  const updatedItem = await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
    include: {
      product: {
        select: { price: true, discountPercent: true, discountEnabled: true },
      },
    },
  });
  await touchCartActivity(userId);

  if (isAjaxRequest(req)) {
    const [cartItems, promoSettings] = await Promise.all([
      prisma.cartItem.findMany({
        where: { userId },
        include: {
          product: {
            select: { price: true, discountPercent: true, discountEnabled: true },
          },
        },
      }),
      getPromoSettings(),
    ]);
    const discountsEnabled = Boolean(
      promoSettings?.enabled && promoSettings?.discountsEnabled,
    );
    const total = cartItems.reduce((sum, item) => {
      const unitPrice = getDiscountedPrice(
        item.product.price,
        getEffectiveDiscountPercent(item.product, discountsEnabled),
      );
      return sum + unitPrice * item.quantity;
    }, 0);
    const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

    const unitPrice = getDiscountedPrice(
      updatedItem.product.price,
      getEffectiveDiscountPercent(updatedItem.product, discountsEnabled),
    );
    return res.json({
      success: true,
      removed: false,
      itemId,
      quantity: updatedItem.quantity,
      bottles: updatedItem.quantity * 12,
      subtotal: unitPrice * updatedItem.quantity,
      total,
      cartCount,
    });
  }

  return res.redirect("/auth/cart");
};

exports.removeCartItem = async (req, res) => {
  const userId = getUserId(req);
  const itemId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!Number.isInteger(itemId)) {
    return res.status(400).send("Invalid cart item id");
  }

  const cartItem = await prisma.cartItem.findUnique({
    where: { id: itemId },
    select: { id: true, userId: true },
  });

  if (!cartItem || cartItem.userId !== userId) {
    return res.status(404).send("Cart item not found");
  }

  await prisma.cartItem.delete({ where: { id: itemId } });
  await touchCartActivity(userId);

  return res.redirect("/auth/cart");
};
