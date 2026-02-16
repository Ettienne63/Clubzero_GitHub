const asyncHandler = require("../utils/asyncHandler");
const cartModel = require("../models/cartModel");
const orderModel = require("../models/orderModel");

exports.submitCheckout = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const items = await cartModel.getItems(userId);
  if (!items.length) {
    return res.redirect(
      "/cart?error=" + encodeURIComponent("Your cart is empty"),
    );
  }

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const orderData = {
    firstName: String(req.body.firstName || "").trim(),
    lastName: String(req.body.lastName || "").trim(),
    email: String(req.body.email || "").trim(),
    phone: String(req.body.phone || "").trim(),
    address: String(req.body.address || "").trim(),
    city: String(req.body.city || "").trim(),
    postalCode: String(req.body.postalCode || "").trim(),
    subtotal,
  };

  await orderModel.createOrder(userId, orderData, items);
  await cartModel.clearCart(userId);

  res.redirect("/thankyou-payment");
});
