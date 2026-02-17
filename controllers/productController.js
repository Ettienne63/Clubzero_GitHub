const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const productModel = require("../models/productModel");

exports.getHomePage = asyncHandler(async (req, res) => {
  const products = await productModel.getAll();
  res.render("pages/home", {
    featuredProducts: products.slice(0, 5),
  });
});

exports.getProducts = asyncHandler(async (req, res) => {
  const search = String(req.query.q || "").trim();
  const products = await productModel.getAll(search);
  res.render("pages/products", { products, search });
});

exports.getProductDetails = asyncHandler(async (req, res) => {
  const product = await productModel.getById(req.params.id);

  if (!product) {
    throw new AppError("Product not found", {
      status: 404,
      exposeMessage: "Product not found",
    });
  }

  res.render("pages/product-details", {
    product,
  });
});
