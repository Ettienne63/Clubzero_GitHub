const { prisma } = require("../lib/prisma");

function mapProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    image: product.image,
    description: product.description || "",
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
  });

  return products.map(mapProduct);
}

async function getById(id) {
  const product = await prisma.product.findUnique({
    where: {
      id: Number(id),
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
