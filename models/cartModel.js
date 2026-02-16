const { prisma } = require("../lib/prisma");

async function getItems(userId) {
  const items = await prisma.cartItem.findMany({
    where: {
      userId: Number(userId),
    },
    include: {
      product: true,
    },
    orderBy: {
      id: "desc",
    },
  });

  return items.map((item) => ({
    productId: item.productId,
    name: item.product.name,
    price: Number(item.product.price),
    image: item.product.image,
    quantity: item.quantity,
    total: Number(item.product.price) * item.quantity,
  }));
}

async function addItem(userId, productId) {
  const parsedUserId = Number(userId);
  const parsedProductId = Number(productId);
  const existing = await prisma.cartItem.findUnique({
    where: {
      userId_productId: {
        userId: parsedUserId,
        productId: parsedProductId,
      },
    },
    select: {
      id: true,
      quantity: true,
    },
  });

  if (existing) {
    await prisma.cartItem.update({
      where: {
        id: existing.id,
      },
      data: {
        quantity: existing.quantity + 1,
      },
    });
    return;
  }

  await prisma.cartItem.create({
    data: {
      userId: parsedUserId,
      productId: parsedProductId,
      quantity: 1,
    },
  });
}

async function updateQuantity(userId, productId, quantity) {
  const qty = Number(quantity);
  const parsedUserId = Number(userId);
  const parsedProductId = Number(productId);

  if (!qty || qty <= 0) {
    await prisma.cartItem.deleteMany({
      where: {
        userId: parsedUserId,
        productId: parsedProductId,
      },
    });
    return;
  }

  await prisma.cartItem.updateMany({
    where: {
      userId: parsedUserId,
      productId: parsedProductId,
    },
    data: {
      quantity: qty,
    },
  });
}

async function removeItem(userId, productId) {
  await prisma.cartItem.deleteMany({
    where: {
      userId: Number(userId),
      productId: Number(productId),
    },
  });
}

async function clearCart(userId) {
  await prisma.cartItem.deleteMany({
    where: {
      userId: Number(userId),
    },
  });
}

module.exports = {
  getItems,
  addItem,
  updateQuantity,
  removeItem,
  clearCart,
};
