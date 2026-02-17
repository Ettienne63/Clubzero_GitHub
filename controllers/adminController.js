const fs = require("fs").promises;
const path = require("path");
const { Prisma } = require("@prisma/client");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");
const productModel = require("../models/productModel");

const DEFAULT_IMAGE = "https://via.placeholder.com/150";

const deleteLocalImage = async (imagePath) => {
  if (!imagePath || !imagePath.startsWith("/uploads/")) {
    return;
  }
  const filename = path.basename(imagePath);
  const fullPath = path.join(__dirname, "..", "public", "uploads", filename);
  try {
    await fs.unlink(fullPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
};

const renderAdminPage = async (req, res, options = {}) => {
  const products = await productModel.getAll();
  res.render("pages/admin", {
    products,
    error: options.error || "",
    success: options.success || "",
  });
};

exports.getAdminPage = asyncHandler(async (req, res) => {
  await renderAdminPage(req, res, {
    error: req.query.error || "",
    success: req.query.success || "",
  });
});

exports.renderAdminWithMessage = async (req, res, next, errorMessage) => {
  try {
    await renderAdminPage(req, res, { error: errorMessage });
  } catch (error) {
    next(error);
  }
};

exports.addProduct = asyncHandler(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const price = Number(req.body.price);
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!name || !description || !Number.isFinite(price) || price <= 0) {
    return res.redirect("/admin?error=Invalid%20product%20details");
  }

  await productModel.insert({
    name,
    price,
    image: imagePath || DEFAULT_IMAGE,
    description,
  });
  res.redirect("/admin?success=Product%20added");
});

exports.updateProductImage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

  if (!imagePath) {
    throw new AppError("Please select an image file", {
      redirectTo: "/admin?error=Please%20select%20an%20image%20file",
      status: 400,
    });
  }

  const previousImage = await productModel.getImageById(id);
  await productModel.updateImage(id, imagePath);

  if (previousImage && previousImage !== imagePath) {
    await deleteLocalImage(previousImage);
  }

  res.redirect("/admin?success=Image%20updated");
});

exports.deleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const previousImage = await productModel.getImageById(id);
  try {
    await productModel.deleteById(id);
  } catch (error) {
    const message = String(error && error.message ? error.message : "").toLowerCase();
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return res.redirect(
        "/admin?error=Cannot%20remove%20a%20product%20that%20already%20exists%20in%20an%20order",
      );
    }
    if (
      message.includes("foreign key constraint") ||
      message.includes("violates restrict setting")
    ) {
      return res.redirect(
        "/admin?error=Cannot%20remove%20a%20product%20that%20already%20exists%20in%20an%20order",
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      return res.redirect("/admin?error=Product%20not%20found");
    }
    throw error;
  }

  if (previousImage) {
    await deleteLocalImage(previousImage);
  }

  res.redirect("/admin?success=Product%20removed");
});

exports.updateProductDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  const price = Number(req.body.price);

  if (!name || !description || !Number.isFinite(price) || price <= 0) {
    return res.redirect("/admin?error=Invalid%20product%20details");
  }

  await productModel.updateDetails(id, { name, price, description });
  res.redirect("/admin?success=Product%20updated");
});
