const { prisma } = require("../lib/prisma");

async function createOrder(userId, orderData, items) {
  const order = await prisma.order.create({
    data: {
      userId: Number(userId),
      firstName: orderData.firstName,
      lastName: orderData.lastName,
      email: orderData.email,
      phone: orderData.phone || null,
      address: orderData.address,
      city: orderData.city,
      postalCode: orderData.postalCode,
      subtotal: Number(orderData.subtotal),
      orderItems: {
        create: items.map((item) => ({
          productId: Number(item.productId),
          productName: item.name,
          unitPrice: Number(item.price),
          quantity: Number(item.quantity),
          lineTotal: Number(item.total),
        })),
      },
    },
    select: {
      id: true,
    },
  });

  return order.id;
}

module.exports = {
  createOrder,
};
