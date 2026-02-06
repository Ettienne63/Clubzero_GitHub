const { getPool, sql } = require("../db/sqlServer");

const normalizeEmail = (email) =>
  String(email || "")
    .trim()
    .toLowerCase();

async function getByEmail(email) {
  const normalized = normalizeEmail(email);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), normalized)
    .query("SELECT Id, Name, Email, PasswordHash FROM Users WHERE Email = @email");
  return result.recordset[0] || null;
}

async function create({ name, email, passwordHash }) {
  const normalized = normalizeEmail(email);
  const pool = await getPool();
  await pool
    .request()
    .input("name", sql.NVarChar(255), name)
    .input("email", sql.NVarChar(255), normalized)
    .input("password", sql.NVarChar(255), passwordHash)
    .query("INSERT INTO Users (Name, Email, PasswordHash) VALUES (@name, @email, @password)");
}

async function updatePasswordByEmail(email, passwordHash) {
  const normalized = normalizeEmail(email);
  const pool = await getPool();
  await pool
    .request()
    .input("email", sql.NVarChar(255), normalized)
    .input("password", sql.NVarChar(255), passwordHash)
    .query("UPDATE Users SET PasswordHash = @password WHERE Email = @email");
}

module.exports = {
  normalizeEmail,
  getByEmail,
  create,
  updatePasswordByEmail,
};
