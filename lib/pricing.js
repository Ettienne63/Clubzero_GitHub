const clampDiscountPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.min(parsed, 90);
};

const getDiscountedPrice = (price, discountPercent) => {
  const base = Number(price);
  if (!Number.isFinite(base)) {
    return 0;
  }
  const percent = clampDiscountPercent(discountPercent);
  if (!percent) {
    return base;
  }
  return base * (1 - percent / 100);
};

const getPriceSummary = (product) => {
  const basePrice = Number(product?.price);
  const discountPercent = clampDiscountPercent(product?.discountPercent);
  const discountedPrice = getDiscountedPrice(basePrice, discountPercent);
  return {
    basePrice,
    discountPercent,
    discountedPrice,
    hasDiscount: discountPercent > 0,
  };
};

module.exports = {
  clampDiscountPercent,
  getDiscountedPrice,
  getPriceSummary,
};
