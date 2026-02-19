const asyncHandler = require("../utils/asyncHandler");
const reviewModel = require("../models/reviewModel");
const productModel = require("../models/productModel");

exports.submitProductReview = asyncHandler(async (req, res) => {
  const productId = Number(req.params.id);
  const userId = Number(req.session.user.id);
  const rating = Number(req.body.rating);
  const comment = String(req.body.comment || "");

  const product = await productModel.getById(productId);
  if (!product) {
    return res.redirect("/products?error=Product%20not%20found");
  }

  const canReview = await reviewModel.hasVerifiedPurchase(userId, productId);
  if (!canReview) {
    return res.redirect(
      `/products/${productId}?error=${encodeURIComponent("Only verified purchasers can leave a review")}`,
    );
  }

  await reviewModel.upsertReview({
    userId,
    productId,
    rating,
    comment,
  });

  return res.redirect(
    `/products/${productId}?success=${encodeURIComponent("Review saved")}`,
  );
});
