const asyncHandler = require("../utils/asyncHandler");
const cartModel = require("../models/cartModel");
const orderModel = require("../models/orderModel");

const mapItems = (rows) =>
  rows.map((row) => ({
    productId: row.ProductId,
    name: row.Name,
    price: Number(row.Price),
    image: row.Image,
    quantity: Number(row.Quantity),
    total: Number(row.Price) * Number(row.Quantity),
  }));

exports.submitCheckout = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  const items = mapItems(await cartModel.getItems(userEmail));
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

  await orderModel.createOrder(userEmail, orderData, items);
  await cartModel.clearCart(userEmail);

  res.redirect("/thankyou-payment");
});
