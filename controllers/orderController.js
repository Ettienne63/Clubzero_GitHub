const asyncHandler = require("../utils/asyncHandler");
const orderModel = require("../models/orderModel");

exports.getOrderHistory = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const orders = await orderModel.getOrdersByUser(userId);
  res.render("pages/orders", { orders });
});
