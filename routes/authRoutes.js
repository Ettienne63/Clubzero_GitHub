const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const authController = require("../controllers/authController");
const cartController = require("../controllers/cartController");
const orderController = require("../controllers/orderController");
const profileController = require("../controllers/profileController");
const goalController = require("../controllers/goalController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../middleware/asyncHandler");
const {
  signupValidationRules,
  loginValidationRules,
  forgotPasswordValidationRules,
  resetPasswordValidationRules,
  reviewValidationRules,
  productIdParamValidationRules,
  cartAddValidationRules,
  customPackAddValidationRules,
  cartUpdateValidationRules,
  cartDeleteValidationRules,
  profileValidationRules,
  addressValidationRules,
  addressIdParamValidationRules,
  goalCreateValidationRules,
  idParamValidationRules,
  validateBadRequest,
  validateRedirectToSignup,
  validateRedirectToForgotPassword,
  validateRedirectToResetPassword,
  validateRedirectToLogin,
  validateRedirectToProducts,
  validateRedirectToProfile,
  validateRedirectToGoals,
} = require("../middleware/validation");

router.get("/signup", authController.getSignup);
router.post(
  "/signup",
  signupValidationRules,
  validateRedirectToSignup,
  asyncHandler(authController.postSignup),
);

router.get("/login", authController.getLogin);
router.post(
  "/login",
  loginValidationRules,
  validateRedirectToLogin,
  asyncHandler(authController.postLogin),
);
router.get("/invite/:token", asyncHandler(authController.getInvite));
router.post("/invite/:token", asyncHandler(authController.postInviteAccept));
router.get("/forgot-password", authController.getForgotPassword);
router.post(
  "/forgot-password",
  forgotPasswordValidationRules,
  validateRedirectToForgotPassword,
  asyncHandler(authController.postForgotPassword),
);
router.get("/reset-password", asyncHandler(authController.getResetPassword));
router.post(
  "/reset-password",
  resetPasswordValidationRules,
  validateRedirectToResetPassword,
  asyncHandler(authController.postResetPassword),
);
router.get("/logout", authController.logout);

router.get("/profile", requireAuth, asyncHandler(profileController.getProfilePage));
router.post(
  "/profile",
  requireAuth,
  profileValidationRules,
  validateRedirectToProfile,
  asyncHandler(profileController.updateProfile),
);
router.post(
  "/profile/addresses",
  requireAuth,
  addressValidationRules,
  validateRedirectToProfile,
  asyncHandler(profileController.createAddress),
);
router.post(
  "/profile/addresses/:id/edit",
  requireAuth,
  addressIdParamValidationRules,
  addressValidationRules,
  validateRedirectToProfile,
  asyncHandler(profileController.updateAddress),
);
router.post(
  "/profile/addresses/:id/delete",
  requireAuth,
  addressIdParamValidationRules,
  validateRedirectToProfile,
  asyncHandler(profileController.deleteAddress),
);

router.get("/products", asyncHandler(productController.listProducts));
router.get(
  "/products/:id",
  productIdParamValidationRules,
  validateBadRequest,
  asyncHandler(productController.getProductDetails),
);
router.post(
  "/products/:id/reviews",
  requireAuth,
  reviewValidationRules,
  validateRedirectToProducts,
  asyncHandler(productController.createReview),
);
router.get("/cart", requireAuth, asyncHandler(cartController.getCart));
router.post(
  "/cart/add",
  requireAuth,
  cartAddValidationRules,
  validateBadRequest,
  asyncHandler(cartController.addToCart),
);
router.post(
  "/cart/add-custom-pack",
  requireAuth,
  customPackAddValidationRules,
  validateRedirectToProducts,
  asyncHandler(cartController.addCustomPackToCart),
);
router.post(
  "/cart/:id/update",
  requireAuth,
  cartUpdateValidationRules,
  validateBadRequest,
  asyncHandler(cartController.updateCartItem),
);
router.post(
  "/cart/:id/delete",
  requireAuth,
  cartDeleteValidationRules,
  validateBadRequest,
  asyncHandler(cartController.removeCartItem),
);
router.get("/checkout", requireAuth, asyncHandler(orderController.getCheckout));
router.post("/checkout", requireAuth, asyncHandler(orderController.postCheckout));
router.get("/checkout/paystack", asyncHandler(orderController.handlePaystackCallback));
router.get(
  "/orders/thank-you/:id",
  requireAuth,
  asyncHandler(orderController.getOrderThankYou),
);
router.get(
  "/orders/:id/invoice",
  requireAuth,
  asyncHandler(orderController.getOrderInvoice),
);
router.post(
  "/orders/:id/pay",
  requireAuth,
  idParamValidationRules,
  validateBadRequest,
  asyncHandler(orderController.retryPaystackPayment),
);
router.get("/orders", requireAuth, asyncHandler(orderController.getOrderHistory));
router.get(
  "/affiliate/join",
  requireAuth,
  asyncHandler(orderController.getAffiliateJoinPage),
);
router.post(
  "/affiliate/join",
  requireAuth,
  asyncHandler(orderController.postAffiliateJoin),
);
router.get(
  "/affiliate",
  requireAuth,
  asyncHandler(orderController.getAffiliateDashboard),
);
router.get("/goals", requireAuth, asyncHandler(goalController.getGoalsPage));
router.post(
  "/goals",
  requireAuth,
  goalCreateValidationRules,
  validateRedirectToGoals,
  asyncHandler(goalController.createGoal),
);
router.get(
  "/goals/:id/edit",
  requireAuth,
  idParamValidationRules,
  validateRedirectToGoals,
  asyncHandler(goalController.getEditGoalPage),
);
router.post(
  "/goals/:id/edit",
  requireAuth,
  idParamValidationRules,
  goalCreateValidationRules,
  validateRedirectToGoals,
  asyncHandler(goalController.updateGoal),
);
router.post(
  "/goals/:id/delete",
  requireAuth,
  idParamValidationRules,
  validateRedirectToGoals,
  asyncHandler(goalController.deleteGoal),
);

module.exports = router;
