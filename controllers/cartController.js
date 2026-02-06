const asyncHandler = require("../utils/asyncHandler");
const cartModel = require("../models/cartModel");

const mapItems = (rows) =>
  rows.map((row) => ({
    productId: row.ProductId,
    name: row.Name,
    price: Number(row.Price),
    image: row.Image,
    quantity: Number(row.Quantity),
    total: Number(row.Price) * Number(row.Quantity),
  }));

exports.getCart = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  const items = mapItems(await cartModel.getItems(userEmail));
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  res.render("pages/cart", { items, subtotal });
});

exports.addToCart = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  await cartModel.addItem(userEmail, req.params.id);
  const back = req.get("referer");
  res.redirect(back || "/products");
});

exports.updateCartItem = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  await cartModel.updateQuantity(userEmail, req.params.id, req.body.quantity);
  res.redirect("/cart");
});

exports.removeCartItem = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  await cartModel.removeItem(userEmail, req.params.id);
  res.redirect("/cart");
});

exports.clearCart = asyncHandler(async (req, res) => {
  const userEmail = req.session.user.email;
  await cartModel.clearCart(userEmail);
  res.redirect("/cart");
});
