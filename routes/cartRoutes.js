const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const { requireAuth } = require("../middelware/requireAuth");
const { body, param, validationResult } = require("express-validator");

const validateAndRedirect = (redirectPath) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array()[0].msg;
    return res.redirect(
      `${redirectPath}?error=${encodeURIComponent(message)}`,
    );
  }
  return next();
};

router.get("/cart", requireAuth, cartController.getCart);
router.post(
  "/cart/add/:id",
  requireAuth,
  [param("id").isInt({ min: 1 }).withMessage("Invalid product id")],
  validateAndRedirect("/products"),
  cartController.addToCart,
);
router.post(
  "/cart/update/:id",
  requireAuth,
  [
    param("id").isInt({ min: 1 }).withMessage("Invalid product id"),
    body("quantity").isInt({ min: 1 }).withMessage("Quantity must be at least 1"),
  ],
  validateAndRedirect("/cart"),
  cartController.updateCartItem,
);
router.post(
  "/cart/remove/:id",
  requireAuth,
  [param("id").isInt({ min: 1 }).withMessage("Invalid product id")],
  validateAndRedirect("/cart"),
  cartController.removeCartItem,
);
router.post("/cart/clear", requireAuth, cartController.clearCart);

module.exports = router;
