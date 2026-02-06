const asyncHandler = require("../utils/asyncHandler");
const productModel = require("../models/productModel");

exports.getProducts = asyncHandler(async (req, res) => {
  const search = String(req.query.q || "").trim();
  const products = await productModel.getAll(search);
  res.render("pages/products", { products, search });
});
