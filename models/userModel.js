const { prisma } = require("../lib/prisma");

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

async function getByEmail(email) {
  const normalized = normalizeEmail(email);
  return prisma.user.findUnique({
    where: {
      email: normalized,
    },
  });
}

async function create({ name, email, passwordHash }) {
  const normalized = normalizeEmail(email);
  return prisma.user.create({
    data: {
      name,
      email: normalized,
      passwordHash,
    },
  });
}

async function updatePasswordByEmail(email, passwordHash) {
  const normalized = normalizeEmail(email);
  await prisma.user.update({
    where: {
      email: normalized,
    },
    data: {
      passwordHash,
    },
  });
}

module.exports = {
  normalizeEmail,
  getByEmail,
  create,
  updatePasswordByEmail,
};
