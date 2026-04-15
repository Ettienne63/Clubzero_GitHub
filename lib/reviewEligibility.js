const { parseCustomPackConfig } = require("./customPack");

const buildPurchasedProductIdSet = (orderItems = []) => {
  const purchased = new Set();
  (orderItems || []).forEach((item) => {
    if (Number.isInteger(item?.productId) && item.productId > 0) {
      purchased.add(item.productId);
    }

    if (item?.isCustomPack) {
      parseCustomPackConfig(item.customPackConfig).forEach((entry) => {
        if (Number.isInteger(entry.productId) && entry.productId > 0) {
          purchased.add(entry.productId);
        }
      });
    }
  });

  return purchased;
};

const getPurchasedProductIdsForUser = async (prisma, userId) => {
  if (!Number.isInteger(userId)) {
    return new Set();
  }

  const purchasedItems = await prisma.orderItem.findMany({
    where: {
      order: { userId, status: "PAID" },
    },
    select: {
      productId: true,
      isCustomPack: true,
      customPackConfig: true,
    },
  });

  return buildPurchasedProductIdSet(purchasedItems);
};

module.exports = {
  buildPurchasedProductIdSet,
  getPurchasedProductIdsForUser,
};
