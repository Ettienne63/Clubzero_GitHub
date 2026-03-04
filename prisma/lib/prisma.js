require("dotenv/config");

const { PrismaPg } = require("@prisma/adapter-pg");
const { PrismaClient } = require("@prisma/client");

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg(
  { connectionString },
  { schema: process.env.DB_SCHEMA || "clubzero_setup" },
);
const prisma = new PrismaClient({ adapter });

module.exports = { prisma };
