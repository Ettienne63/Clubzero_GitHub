const { getPool, sql } = require("../db/sqlServer");

const mapProducts = (rows) =>
  rows.map((row) => ({
    id: row.Id,
    name: row.Name,
    price: Number(row.Price),
    image: row.Image,
  }));

async function getAll(searchTerm = "") {
  const pool = await getPool();
  const request = pool.request();
  let query = "SELECT Id, Name, Price, Image FROM Products ORDER BY Id DESC";

  if (searchTerm) {
    request.input("search", sql.NVarChar(255), `%${searchTerm}%`);
    query =
      "SELECT Id, Name, Price, Image FROM Products WHERE Name LIKE @search ORDER BY Id DESC";
  }

  const result = await request.query(query);
  return mapProducts(result.recordset);
}

async function getImageById(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.Int, Number(id))
    .query("SELECT Image FROM Products WHERE Id = @id");
  return result.recordset[0]?.Image || null;
}

async function insert({ name, price, image }) {
  const pool = await getPool();
  await pool
    .request()
    .input("name", sql.NVarChar(255), name)
    .input("price", sql.Decimal(10, 2), Number(price))
    .input("image", sql.NVarChar(1000), image)
    .query("INSERT INTO Products (Name, Price, Image) VALUES (@name, @price, @image)");
}

async function updateImage(id, image) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, Number(id))
    .input("image", sql.NVarChar(1000), image)
    .query("UPDATE Products SET Image = @image WHERE Id = @id");
}

async function updateDetails(id, { name, price }) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, Number(id))
    .input("name", sql.NVarChar(255), name)
    .input("price", sql.Decimal(10, 2), Number(price))
    .query("UPDATE Products SET Name = @name, Price = @price WHERE Id = @id");
}

async function deleteById(id) {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, Number(id))
    .query("DELETE FROM Products WHERE Id = @id");
}

module.exports = {
  getAll,
  getImageById,
  insert,
  updateImage,
  updateDetails,
  deleteById,
};
