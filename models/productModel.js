const { prisma } = require("../lib/prisma");

function buildRatingSummary(reviews = []) {
  const ratingCount = reviews.length;
  if (!ratingCount) {
    return { ratingAverage: 0, ratingCount: 0 };
  }
  const total = reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0);
  return {
    ratingAverage: Number((total / ratingCount).toFixed(1)),
    ratingCount,
  };
}

function mapProduct(product) {
  const ratings = buildRatingSummary(product.reviews || []);
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    image: product.image,
    description: product.description || "",
    ratingAverage: ratings.ratingAverage,
    ratingCount: ratings.ratingCount,
    reviews: (product.reviews || []).map((review) => ({
      id: review.id,
      userId: review.userId,
      rating: Number(review.rating),
      comment: review.comment || "",
      createdAt: review.createdAt,
      userName: review.user ? review.user.name : "",
    })),
  };
}

async function getAll(searchTerm = "") {
  const products = await prisma.product.findMany({
    where: searchTerm
      ? {
          name: {
            contains: searchTerm,
            mode: "insensitive",
          },
        }
      : undefined,
    orderBy: {
      id: "desc",
    },
    include: {
      reviews: {
        select: {
          rating: true,
        },
      },
    },
  });

  return products.map(mapProduct);
}

async function getById(id) {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(id),
    },
    include: {
      reviews: {
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    return null;
  }

  return mapProduct(product);
}

async function getImageById(id) {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(id),
    },
    select: {
      image: true,
    },
  });
  return product?.image || null;
}

async function insert({ name, price, image, description }) {
  await prisma.product.create({
    data: {
      name,
      price: Number(price),
      image,
      description,
    },
  });
}

async function updateImage(id, image) {
  await prisma.product.update({
    where: {
      id: Number(id),
    },
    data: {
      image,
    },
  });
}

async function updateDetails(id, { name, price, description }) {
  await prisma.product.update({
    where: {
      id: Number(id),
    },
    data: {
      name,
      price: Number(price),
      description,
    },
  });
}

async function deleteById(id) {
  await prisma.product.delete({
    where: {
      id: Number(id),
    },
  });
}

module.exports = {
  getAll,
  getById,
  getImageById,
  insert,
  updateImage,
  updateDetails,
  deleteById,
};
