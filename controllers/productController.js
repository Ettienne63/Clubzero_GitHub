const { prisma } = require("../prisma/lib/prisma");

const toOptionalText = (value) => {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
};

const productWithReviewsInclude = {
  reviews: {
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { id: "desc" },
  },
};

const mapProductWithReviewStats = (product) => {
  const ratings = product.reviews.map((review) => review.rating);
  const averageRating = ratings.length
    ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
    : null;

  return {
    ...product,
    averageRating,
    reviewCount: product.reviews.length,
  };
};

const getRecentlyViewedProductIds = (req) => {
  const ids = Array.isArray(req.session?.recentlyViewedProductIds)
    ? req.session.recentlyViewedProductIds
    : [];

  return ids
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isInteger(id) && id > 0);
};

const setRecentlyViewedProductIds = (req, ids) => {
  if (!req.session) {
    return;
  }

  req.session.recentlyViewedProductIds = ids.slice(0, 5);
};

const parseProductInput = (body, file, options = {}) => {
  const { currentImageUrl = "", requireImage = true } = options;
  const name = (body.name || "").trim();
  const imageUrlFromInput = (body.imageUrl || "").trim();
  const description = (body.description || "").trim();
  const nutritionInfo = toOptionalText(body.nutritionInfo);
  const ingredients = toOptionalText(body.ingredients);
  const bestFor = toOptionalText(body.bestFor);
  const storageInfo = toOptionalText(body.storageInfo);
  const price = Number.parseFloat(body.price);
  const imageUrl = file
    ? `/uploads/${file.filename}`
    : imageUrlFromInput || currentImageUrl;

  if (!name || !description || (requireImage && !imageUrl)) {
    return { error: "Name, image, and description are required." };
  }

  if (!Number.isFinite(price) || price < 0) {
    return { error: "Price must be a valid non-negative number." };
  }

  return {
    data: {
      name,
      imageUrl,
      description,
      price,
      nutritionInfo,
      ingredients,
      bestFor,
      storageInfo,
    },
  };
};

const getProducts = (search = "", options = {}) => {
  const { includeInactive = false } = options;
  const trimmedSearch = search.trim();
  const where = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(trimmedSearch
      ? {
          OR: [
            { name: { contains: trimmedSearch, mode: "insensitive" } },
            { description: { contains: trimmedSearch, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  return prisma.product.findMany({
    where,
    include: productWithReviewsInclude,
    orderBy: { id: "desc" },
  });
};

exports.listProducts = async (req, res) => {
  const searchQuery = (req.query.search || "").toString();
  const userId = Number.parseInt(req.session?.user?.id, 10);
  const [products, recentlyViewedProductsRaw] = await Promise.all([
    getProducts(searchQuery),
    prisma.product.findMany({
      where: { id: { in: getRecentlyViewedProductIds(req) }, isActive: true },
      include: productWithReviewsInclude,
    }),
  ]);
  let purchasedProductIds = [];
  let myReviewsByProduct = {};

  const recentlyViewedProductsById = recentlyViewedProductsRaw.reduce(
    (acc, product) => {
      acc[product.id] = mapProductWithReviewStats(product);
      return acc;
    },
    {},
  );
  const recentlyViewedProducts = getRecentlyViewedProductIds(req)
    .map((id) => recentlyViewedProductsById[id])
    .filter(Boolean);

  if (Number.isInteger(userId)) {
    const [purchasedItems, myReviews] = await Promise.all([
      prisma.orderItem.findMany({
        where: { order: { userId } },
        distinct: ["productId"],
        select: { productId: true },
      }),
      prisma.review.findMany({
        where: { userId },
        select: { productId: true, rating: true, comment: true },
      }),
    ]);

    purchasedProductIds = purchasedItems.map((item) => item.productId);
    myReviewsByProduct = myReviews.reduce((acc, review) => {
      acc[review.productId] = {
        rating: review.rating,
        comment: review.comment || "",
      };
      return acc;
    }, {});
  }

  const productsWithStats = products.map(mapProductWithReviewStats);

  res.render("products", {
    products: productsWithStats,
    recentlyViewedProducts,
    searchQuery,
    success: req.query.success || null,
    error: req.query.error || null,
    purchasedProductIds,
    myReviewsByProduct,
  });
};

exports.getProductDetails = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);
  const isAdmin = ["ADMIN", "OWNER"].includes(
    String(req.session?.user?.role || "").toUpperCase(),
  );

  const product = await prisma.product.findFirst({
    where: {
      id: productId,
      ...(isAdmin ? {} : { isActive: true }),
    },
    include: productWithReviewsInclude,
  });

  if (!product) {
    return res.status(404).send("Product not found");
  }

  const existingIds = getRecentlyViewedProductIds(req).filter(
    (id) => id !== productId,
  );
  setRecentlyViewedProductIds(req, [productId, ...existingIds]);

  return res.render("product-details", {
    product: mapProductWithReviewStats(product),
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.createReview = async (req, res) => {
  const userId = Number.parseInt(req.session?.user?.id, 10);
  const productId = Number.parseInt(req.params.id, 10);
  const rating = Number.parseInt(req.body.rating, 10);
  const comment = (req.body.comment || "").trim();

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });

  if (!product) {
    return res.redirect(
      `/auth/products?error=${encodeURIComponent(
        "This product is no longer available.",
      )}`,
    );
  }

  const purchased = await prisma.orderItem.findFirst({
    where: {
      productId,
      order: { userId },
    },
    select: { id: true },
  });

  if (!purchased) {
    return res.redirect(
      `/auth/products?error=${encodeURIComponent("You can only review products you have purchased.")}`,
    );
  }

  await prisma.review.upsert({
    where: {
      userId_productId: {
        userId,
        productId,
      },
    },
    create: {
      userId,
      productId,
      rating,
      comment: comment || null,
    },
    update: {
      rating,
      comment: comment || null,
    },
  });

  return res.redirect(
    `/auth/products?success=${encodeURIComponent("Your review has been saved.")}`,
  );
};

exports.getAdminPage = async (req, res) => {
  const products = await getProducts("", { includeInactive: true });

  res.render("admin", {
    products,
    success: req.query.success || null,
    error: req.query.error || null,
    formData: {
      name: "",
      imageUrl: "",
      description: "",
      price: "",
      nutritionInfo: "",
      ingredients: "",
      bestFor: "",
      storageInfo: "",
    },
  });
};

exports.createProduct = async (req, res) => {
  const parsed = parseProductInput(req.body, req.file);

  if (parsed.error) {
    const products = await getProducts();
    return res.status(400).render("admin", {
      products,
      success: null,
      error: parsed.error,
      formData: req.body,
    });
  }

  try {
    await prisma.product.create({ data: parsed.data });
    return res.redirect("/admin?success=Product+created");
  } catch (error) {
    const products = await getProducts();
    const errorMessage =
      error.code === "P2002"
        ? "A product with this name already exists."
        : "Unable to create product. Please try again.";

    return res.status(400).render("admin", {
      products,
      success: null,
      error: errorMessage,
      formData: req.body,
    });
  }
};

exports.updateProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existingProduct) {
    return res.status(404).send("Product not found");
  }

  const parsed = parseProductInput(req.body, req.file, {
    currentImageUrl: existingProduct.imageUrl,
    requireImage: true,
  });

  if (parsed.error) {
    return res.redirect(`/admin?error=${encodeURIComponent(parsed.error)}`);
  }

  try {
    await prisma.product.update({
      where: { id: productId },
      data: parsed.data,
    });

    return res.redirect("/admin?success=Product+updated");
  } catch (error) {
    if (error.code === "P2025") {
      return res.status(404).send("Product not found");
    }

    const errorMessage =
      error.code === "P2002"
        ? "A product with this name already exists."
        : "Unable to update product. Please try again.";

    return res.redirect(`/admin?error=${encodeURIComponent(errorMessage)}`);
  }
};

exports.deleteProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });

  if (!existingProduct) {
    return res.redirect("/admin?error=Product+not+found");
  }

  if (!existingProduct.isActive) {
    return res.redirect("/admin?success=Product+already+hidden");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: false },
  });

  return res.redirect("/admin?success=Product+hidden");
};

exports.restoreProduct = async (req, res) => {
  const productId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(productId)) {
    return res.status(400).send("Invalid product id");
  }

  const existingProduct = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true },
  });

  if (!existingProduct) {
    return res.redirect("/admin?error=Product+not+found");
  }

  if (existingProduct.isActive) {
    return res.redirect("/admin?success=Product+already+visible");
  }

  await prisma.product.update({
    where: { id: productId },
    data: { isActive: true },
  });

  return res.redirect("/admin?success=Product+restored");
};
