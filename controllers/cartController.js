const asyncHandler = require("../utils/asyncHandler");
const cartModel = require("../models/cartModel");

exports.getCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const items = await cartModel.getItems(userId);
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  res.render("pages/cart", { items, subtotal });
});

exports.addToCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  await cartModel.addItem(userId, req.params.id);
  const back = req.get("referer");
  res.redirect(back || "/products");
});

exports.updateCartItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  await cartModel.updateQuantity(userId, req.params.id, req.body.quantity);
  res.redirect("/cart");
});

exports.removeCartItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  await cartModel.removeItem(userId, req.params.id);
  res.redirect("/cart");
});

exports.clearCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  await cartModel.clearCart(userId);
  res.redirect("/cart");
});
