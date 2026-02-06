const { getPool, sql } = require("../db/sqlServer");

async function getItems(userEmail) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .query(
      `
      SELECT c.ProductId, c.Quantity, p.Name, p.Price, p.Image
      FROM CartItems c
      INNER JOIN Products p ON p.Id = c.ProductId
      WHERE c.UserEmail = @email
      ORDER BY c.Id DESC
      `,
    );
  return result.recordset;
}

async function addItem(userEmail, productId) {
  const pool = await getPool();
  const existing = await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .input("productId", sql.Int, Number(productId))
    .query(
      "SELECT Id, Quantity FROM CartItems WHERE UserEmail = @email AND ProductId = @productId",
    );

  if (existing.recordset.length) {
    const row = existing.recordset[0];
    await pool
      .request()
      .input("id", sql.Int, row.Id)
      .input("quantity", sql.Int, row.Quantity + 1)
      .query("UPDATE CartItems SET Quantity = @quantity WHERE Id = @id");
    return;
  }

  await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .input("productId", sql.Int, Number(productId))
    .input("quantity", sql.Int, 1)
    .query(
      "INSERT INTO CartItems (UserEmail, ProductId, Quantity) VALUES (@email, @productId, @quantity)",
    );
}

async function updateQuantity(userEmail, productId, quantity) {
  const qty = Number(quantity);
  const pool = await getPool();

  if (!qty || qty <= 0) {
    await pool
      .request()
      .input("email", sql.NVarChar(255), userEmail)
      .input("productId", sql.Int, Number(productId))
      .query(
        "DELETE FROM CartItems WHERE UserEmail = @email AND ProductId = @productId",
      );
    return;
  }

  await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .input("productId", sql.Int, Number(productId))
    .input("quantity", sql.Int, qty)
    .query(
      "UPDATE CartItems SET Quantity = @quantity WHERE UserEmail = @email AND ProductId = @productId",
    );
}

async function removeItem(userEmail, productId) {
  const pool = await getPool();
  await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .input("productId", sql.Int, Number(productId))
    .query(
      "DELETE FROM CartItems WHERE UserEmail = @email AND ProductId = @productId",
    );
}

async function clearCart(userEmail) {
  const pool = await getPool();
  await pool
    .request()
    .input("email", sql.NVarChar(255), userEmail)
    .query("DELETE FROM CartItems WHERE UserEmail = @email");
}

module.exports = {
  getItems,
  addItem,
  updateQuantity,
  removeItem,
  clearCart,
};
