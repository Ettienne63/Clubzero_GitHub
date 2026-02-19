const express = require("express");
const router = express.Router();
const { body, param, validationResult } = require("express-validator");

const productController = require("../controllers/productController");
const reviewController = require("../controllers/reviewController");
const { requireAuth } = require("../middelware/requireAuth");

const validateAndRedirect = (redirectPath) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array()[0].msg;
    return res.redirect(`${redirectPath}?error=${encodeURIComponent(message)}`);
  }
  return next();
};

router.get("/", productController.getHomePage);

router.get("/about", (req, res) => {
  res.render("pages/about");
});

router.get("/products", productController.getProducts);
router.get("/products/:id", productController.getProductDetails);
router.post(
  "/products/:id/reviews",
  requireAuth,
  [
    param("id").isInt({ min: 1 }).withMessage("Invalid product id"),
    body("rating")
      .isInt({ min: 1, max: 5 })
      .withMessage("Rating must be between 1 and 5"),
    body("comment")
      .optional({ values: "falsy" })
      .isLength({ max: 1000 })
      .withMessage("Review comment must be under 1000 characters"),
  ],
  (req, res, next) => validateAndRedirect(`/products/${req.params.id}`)(req, res, next),
  reviewController.submitProductReview,
);

router.get("/checkout", (req, res) => {
  res.render("pages/checkout");
});

// Cart route handled in routes/cartRoutes.js

router.get("/login", (req, res) => {
  const error = req.query.error || "";
  res.render("pages/login", { error });
});

router.get("/signup", (req, res) => {
  const error = req.query.error || "";
  res.render("pages/signup", { error });
});

module.exports = router;
