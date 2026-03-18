const STOCK_MOVEMENT_REASON_OPTIONS = [
  "RESTOCK",
  "CORRECTION",
  "DAMAGE",
  "TRANSFER",
  "RETURN",
  "COUNT_ADJUSTMENT",
  "OTHER",
];

const toSafeText = (value, maxLength = 255) => {
  const text = (value || "").toString().trim();
  if (!text) {
    return null;
  }
  return text.slice(0, maxLength);
};

const parseNonNegativeInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const parseMovementReason = (value) => {
  const reason = (value || "").toString().trim().toUpperCase();
  if (!reason || !STOCK_MOVEMENT_REASON_OPTIONS.includes(reason)) {
    return null;
  }
  return reason;
};

module.exports = {
  STOCK_MOVEMENT_REASON_OPTIONS,
  toSafeText,
  parseNonNegativeInt,
  parseMovementReason,
};
