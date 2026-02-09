const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cartController");
const checkoutController = require("../controllers/checkoutController");
const { requireAuth } = require("../middelware/requireAuth");
const { body, param, validationResult } = require("express-validator");

const validateAndRedirect = (redirectPath) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const message = errors.array()[0].msg;
    return res.redirect(`${redirectPath}?error=${encodeURIComponent(message)}`);
  }
  return next();
};

router.get("/cart", requireAuth, cartController.getCart);

router.get("/checkout", requireAuth, (req, res) => {
  const error = req.query.error || "";
  res.render("pages/checkout", { error });
});

router.get("/thankyou-payment", (req, res) => {
  res.render("pages/thankyou-payment");
});

router.post(
  "/checkout",
  requireAuth,
  [
    body("firstName").trim().notEmpty().withMessage("First name is required"),
    body("lastName").trim().notEmpty().withMessage("Last name is required"),
    body("email").trim().isEmail().withMessage("Enter a valid email"),
    body("address").trim().notEmpty().withMessage("Address is required"),
    body("city").trim().notEmpty().withMessage("City is required"),
    body("postalCode")
      .trim()
      .notEmpty()
      .withMessage("Postal code is required"),
  ],
  validateAndRedirect("/checkout"),
  checkoutController.submitCheckout,
);
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
    body("quantity")
      .isInt({ min: 1 })
      .withMessage("Quantity must be at least 1"),
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
