const express = require("express");
const router = express.Router();
const adminController = require("../controllers/adminController");
const { requireAdmin } = require("../middelware/requireAuth");
const multer = require("multer");
const path = require("path");
const { body, param, validationResult } = require("express-validator");

const uploadDir = path.join(__dirname, "../public/uploads");
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const base = path.basename(file.originalname || "image", ext);
    const safeBase = base.replace(/[^a-z0-9-_]/gi, "_");
    cb(null, `${Date.now()}_${safeBase}${ext || ".jpg"}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }
    return cb(new Error("Only image files are allowed"));
  },
});

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

const handleUpload = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image is too large (max 5MB)"
          : err.message || "Upload failed";
      return adminController.renderAdminWithMessage(req, res, next, message);
    }
    return next();
  });
};

router.get("/admin", requireAdmin, adminController.getAdminPage);
router.post(
  "/admin/add-product",
  requireAdmin,
  handleUpload,
  [
    body("name").trim().notEmpty().withMessage("Product name is required"),
    body("price")
      .isFloat({ min: 0.01 })
      .withMessage("Price must be a positive number"),
  ],
  validateAndRedirect("/admin"),
  adminController.addProduct,
);
router.post(
  "/admin/update-product-image/:id",
  requireAdmin,
  [param("id").isInt({ min: 1 }).withMessage("Invalid product id")],
  validateAndRedirect("/admin"),
  handleUpload,
  adminController.updateProductImage,
);
router.post(
  "/admin/update-product/:id",
  requireAdmin,
  [
    param("id").isInt({ min: 1 }).withMessage("Invalid product id"),
    body("name").trim().notEmpty().withMessage("Product name is required"),
    body("price")
      .isFloat({ min: 0.01 })
      .withMessage("Price must be a positive number"),
  ],
  validateAndRedirect("/admin"),
  adminController.updateProductDetails,
);
router.post(
  "/admin/delete-product/:id",
  requireAdmin,
  [param("id").isInt({ min: 1 }).withMessage("Invalid product id")],
  validateAndRedirect("/admin"),
  adminController.deleteProduct,
);

module.exports = router;
