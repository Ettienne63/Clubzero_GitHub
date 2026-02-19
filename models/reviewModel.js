const { prisma } = require("../lib/prisma");

async function hasVerifiedPurchase(userId, productId) {
  const match = await prisma.orderItem.findFirst({
    where: {
      productId: Number(productId),
      order: {
        userId: Number(userId),
      },
    },
    select: {
      id: true,
    },
  });
  return Boolean(match);
}

async function getUserReview(userId, productId) {
  return prisma.productReview.findUnique({
    where: {
      userId_productId: {
        userId: Number(userId),
        productId: Number(productId),
      },
    },
  });
}

async function upsertReview({ userId, productId, rating, comment }) {
  const cleanedComment = String(comment || "").trim();
  return prisma.productReview.upsert({
    where: {
      userId_productId: {
        userId: Number(userId),
        productId: Number(productId),
      },
    },
    update: {
      rating: Number(rating),
      comment: cleanedComment || null,
    },
    create: {
      userId: Number(userId),
      productId: Number(productId),
      rating: Number(rating),
      comment: cleanedComment || null,
    },
  });
}

module.exports = {
  hasVerifiedPurchase,
  getUserReview,
  upsertReview,
};
