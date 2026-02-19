const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const productModel = require("../models/productModel");
const reviewModel = require("../models/reviewModel");

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

  const user = req.session.user || null;
  const error = req.query.error || "";
  const success = req.query.success || "";
  let canReview = false;
  let existingReview = null;

  if (user) {
    canReview = await reviewModel.hasVerifiedPurchase(user.id, product.id);
    existingReview = await reviewModel.getUserReview(user.id, product.id);
  }

  res.render("pages/product-details", {
    product,
    error,
    success,
    canReview,
    existingReview,
  });
});
