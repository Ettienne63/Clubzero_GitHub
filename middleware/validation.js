const { body, param, validationResult } = require("express-validator");

const getFirstValidationMessage = (req) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return null;
  }

  return errors.array({ onlyFirstError: true })[0].msg;
};

const handleValidationError = (onError) => (req, res, next) => {
  const message = getFirstValidationMessage(req);
  if (!message) {
    return next();
  }

  return onError(req, res, message);
};

const validateBadRequest = handleValidationError((_req, res, message) =>
  res.status(400).send(message),
);

const validateRedirectToLogin = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/login?error=${encodeURIComponent(message)}`),
);

const validateRedirectToSignup = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/signup?error=${encodeURIComponent(message)}`),
);

const validateRedirectToForgotPassword = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/forgot-password?error=${encodeURIComponent(message)}`),
);

const validateRedirectToResetPassword = handleValidationError((req, res, message) => {
  const token = encodeURIComponent((req.body.token || req.query.token || "").toString());
  return res.redirect(`/auth/reset-password?token=${token}&error=${encodeURIComponent(message)}`);
});

const validateRedirectToProducts = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/products?error=${encodeURIComponent(message)}`),
);

const validateRedirectToAdmin = handleValidationError((_req, res, message) =>
  res.redirect(`/admin?error=${encodeURIComponent(message)}`),
);

const validateRedirectToAdminAffiliate = handleValidationError(
  (_req, res, message) =>
    res.redirect(`/admin/affiliate/stats?error=${encodeURIComponent(message)}`),
);

const validateRedirectToAdminLocations = handleValidationError(
  (_req, res, message) =>
    res.redirect(`/admin/locations?error=${encodeURIComponent(message)}`),
);

const validateRedirectToProfile = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/profile?error=${encodeURIComponent(message)}`),
);

const validateRedirectToGoals = handleValidationError((_req, res, message) =>
  res.redirect(`/auth/goals?error=${encodeURIComponent(message)}`),
);

const validateRedirectToContact = handleValidationError((_req, res, message) =>
  res.redirect(`/contact?error=${encodeURIComponent(message)}`),
);

const signupValidationRules = [
  body("name").trim().notEmpty().withMessage("Name is required."),
  body("email").trim().isEmail().withMessage("Valid email is required."),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters."),
];

const loginValidationRules = [
  body("email").trim().isEmail().withMessage("Valid email is required."),
  body("password").notEmpty().withMessage("Password is required."),
];

const forgotPasswordValidationRules = [
  body("email").trim().isEmail().withMessage("Valid email is required."),
];

const resetPasswordValidationRules = [
  body("token").trim().notEmpty().withMessage("Reset token is required."),
  body("password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters."),
  body("confirmPassword")
    .custom((value, { req }) => value === req.body.password)
    .withMessage("Passwords do not match."),
];

const reviewValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid product id."),
  body("rating")
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be between 1 and 5."),
  body("comment")
    .optional({ values: "falsy" })
    .isLength({ max: 300 })
    .withMessage("Comment must be 300 characters or fewer.")
    .trim(),
];

const cartAddValidationRules = [
  body("productId").isInt({ min: 1 }).withMessage("Invalid product id."),
  body("quantity")
    .optional({ values: "falsy" })
    .isInt({ min: 1 })
    .withMessage("Quantity must be at least 1."),
];

const cartUpdateValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid cart item id."),
  body("quantity").isInt({ min: 0 }).withMessage("Quantity must be 0 or more."),
];

const cartDeleteValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid cart item id."),
];

const productValidationRules = [
  body("name").trim().notEmpty().withMessage("Name is required."),
  body("description").trim().notEmpty().withMessage("Description is required."),
  body("price")
    .isFloat({ min: 0 })
    .withMessage("Price must be a valid non-negative number."),
  body("discountPercent")
    .optional({ values: "falsy" })
    .isFloat({ min: 0, max: 90 })
    .withMessage("Discount must be between 0% and 90%."),
  body("imageUrl").optional({ values: "falsy" }).trim(),
  body("nutritionInfo").optional({ values: "falsy" }).trim(),
  body("ingredients").optional({ values: "falsy" }).trim(),
  body("bestFor").optional({ values: "falsy" }).trim(),
  body("storageInfo").optional({ values: "falsy" }).trim(),
];

const productIdParamValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid product id."),
];

const idParamValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid id."),
];

const profileValidationRules = [
  body("name").trim().notEmpty().withMessage("Name is required."),
  body("phone")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 30 })
    .withMessage("Phone number must be 30 characters or fewer."),
];

const addressValidationRules = [
  body("label")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 50 })
    .withMessage("Label must be 50 characters or fewer."),
  body("recipientName")
    .trim()
    .notEmpty()
    .withMessage("Recipient name is required."),
  body("phone").trim().notEmpty().withMessage("Phone is required."),
  body("addressLine1")
    .trim()
    .notEmpty()
    .withMessage("Address line 1 is required."),
  body("addressLine2").optional({ values: "falsy" }).trim(),
  body("city").trim().notEmpty().withMessage("City is required."),
  body("state").trim().notEmpty().withMessage("State or province is required."),
  body("postalCode").trim().notEmpty().withMessage("Postal code is required."),
  body("country").trim().notEmpty().withMessage("Country is required."),
];

const addressIdParamValidationRules = [
  param("id").isInt({ min: 1 }).withMessage("Invalid address id."),
];

const goalCreateValidationRules = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Goal title is required.")
    .isLength({ max: 120 })
    .withMessage("Goal title must be 120 characters or fewer."),
  body("targetBottles")
    .isInt({ min: 1 })
    .withMessage("Target bottles must be at least 1."),
];

const contactValidationRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Name is required.")
    .isLength({ max: 120 })
    .withMessage("Name must be 120 characters or fewer."),
  body("email")
    .trim()
    .isEmail()
    .withMessage("Valid email is required.")
    .isLength({ max: 254 })
    .withMessage("Email must be 254 characters or fewer."),
  body("message")
    .trim()
    .notEmpty()
    .withMessage("Message is required.")
    .isLength({ max: 2000 })
    .withMessage("Message must be 2000 characters or fewer."),
];

const storeLocationValidationRules = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Location name is required.")
    .isLength({ max: 120 })
    .withMessage("Location name must be 120 characters or fewer."),
  body("addressLine1")
    .trim()
    .notEmpty()
    .withMessage("Address line 1 is required.")
    .isLength({ max: 160 })
    .withMessage("Address line 1 must be 160 characters or fewer."),
  body("addressLine2")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 160 })
    .withMessage("Address line 2 must be 160 characters or fewer."),
  body("city")
    .trim()
    .notEmpty()
    .withMessage("City is required.")
    .isLength({ max: 120 })
    .withMessage("City must be 120 characters or fewer."),
  body("state")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 120 })
    .withMessage("State must be 120 characters or fewer."),
  body("hours")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 120 })
    .withMessage("Hours must be 120 characters or fewer."),
  body("phone")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 40 })
    .withMessage("Phone must be 40 characters or fewer."),
  body("mapUrl")
    .optional({ values: "falsy" })
    .trim()
    .isLength({ max: 300 })
    .withMessage("Map URL must be 300 characters or fewer.")
    .isURL({ require_protocol: true })
    .withMessage("Map URL must start with http(s)://"),
];

const storeLocationIdParamValidationRules = [
  param("id")
    .trim()
    .notEmpty()
    .withMessage("Invalid location id.")
    .isLength({ max: 80 })
    .withMessage("Invalid location id."),
];

module.exports = {
  signupValidationRules,
  loginValidationRules,
  forgotPasswordValidationRules,
  resetPasswordValidationRules,
  reviewValidationRules,
  cartAddValidationRules,
  cartUpdateValidationRules,
  cartDeleteValidationRules,
  productValidationRules,
  productIdParamValidationRules,
  idParamValidationRules,
  profileValidationRules,
  addressValidationRules,
  addressIdParamValidationRules,
  goalCreateValidationRules,
  contactValidationRules,
  storeLocationValidationRules,
  storeLocationIdParamValidationRules,
  validateBadRequest,
  validateRedirectToSignup,
  validateRedirectToForgotPassword,
  validateRedirectToResetPassword,
  validateRedirectToLogin,
  validateRedirectToProducts,
  validateRedirectToAdmin,
  validateRedirectToAdminAffiliate,
  validateRedirectToAdminLocations,
  validateRedirectToProfile,
  validateRedirectToGoals,
  validateRedirectToContact,
};
