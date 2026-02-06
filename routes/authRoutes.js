const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");
const { body, validationResult } = require("express-validator");

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

router.post(
  "/login",
  [
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validateAndRedirect("/login"),
  authController.login,
);

router.post(
  "/signup",
  [
    body("name").trim().notEmpty().withMessage("Name is required"),
    body("email")
      .trim()
      .isEmail()
      .withMessage("Enter a valid email"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validateAndRedirect("/signup"),
  authController.signup,
);
router.post("/logout", authController.logout);

module.exports = router;
