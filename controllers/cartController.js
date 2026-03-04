const { prisma } = require("../prisma/lib/prisma");

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);

exports.getCart = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const cartItems = await prisma.cartItem.findMany({
    where: { userId },
    include: { product: true },
    orderBy: { id: "desc" },
  });

  const total = cartItems.reduce(
    (sum, item) => sum + Number(item.product.price) * item.quantity,
    0,
  );

  return res.render("cart", {
    cartItems,
    total,
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

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    return res.status(404).send("Product not found");
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
    return res.redirect("/auth/cart");
  }

  await prisma.cartItem.update({
    where: { id: itemId },
    data: { quantity },
  });

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

  return res.redirect("/auth/cart");
};
