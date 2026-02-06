const express = require("express");
const router = express.Router();

const productController = require("../controllers/productController");

router.get("/", (req, res) => {
  res.render("pages/home");
});

router.get("/about", (req, res) => {
  res.render("pages/about");
});

router.get("/products", productController.getProducts);

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
