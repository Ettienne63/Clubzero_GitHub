const { prisma } = require("../lib/prisma");

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

  return products.map((product) => ({
    id: product.id,
    name: product.name,
    price: Number(product.price),
    image: product.image,
  }));
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

async function insert({ name, price, image }) {
  await prisma.product.create({
    data: {
      name,
      price: Number(price),
      image,
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

async function updateDetails(id, { name, price }) {
  await prisma.product.update({
    where: {
      id: Number(id),
    },
    data: {
      name,
      price: Number(price),
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
  getImageById,
  insert,
  updateImage,
  updateDetails,
  deleteById,
};
