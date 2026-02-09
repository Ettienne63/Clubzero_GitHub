const { getPool, sql } = require("../db/sqlServer");

async function createOrder(userEmail, orderData, items) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const orderRequest = new sql.Request(transaction);
    orderRequest.input("userEmail", sql.NVarChar(255), userEmail);
    orderRequest.input("firstName", sql.NVarChar(255), orderData.firstName);
    orderRequest.input("lastName", sql.NVarChar(255), orderData.lastName);
    orderRequest.input("email", sql.NVarChar(255), orderData.email);
    orderRequest.input("phone", sql.NVarChar(50), orderData.phone || null);
    orderRequest.input("address", sql.NVarChar(500), orderData.address);
    orderRequest.input("city", sql.NVarChar(255), orderData.city);
    orderRequest.input("postalCode", sql.NVarChar(50), orderData.postalCode);
    orderRequest.input("subtotal", sql.Decimal(10, 2), orderData.subtotal);

    const orderResult = await orderRequest.query(
      `
      INSERT INTO Orders
        (UserEmail, FirstName, LastName, Email, Phone, Address, City, PostalCode, Subtotal)
      OUTPUT INSERTED.Id
      VALUES
        (@userEmail, @firstName, @lastName, @email, @phone, @address, @city, @postalCode, @subtotal)
      `,
    );
    const orderId = orderResult.recordset[0].Id;

    for (const item of items) {
      const itemRequest = new sql.Request(transaction);
      itemRequest.input("orderId", sql.Int, orderId);
      itemRequest.input("productId", sql.Int, item.productId);
      itemRequest.input("productName", sql.NVarChar(255), item.name);
      itemRequest.input("unitPrice", sql.Decimal(10, 2), item.price);
      itemRequest.input("quantity", sql.Int, item.quantity);
      itemRequest.input("lineTotal", sql.Decimal(10, 2), item.total);

      await itemRequest.query(
        `
        INSERT INTO OrderItems
          (OrderId, ProductId, ProductName, UnitPrice, Quantity, LineTotal)
        VALUES
          (@orderId, @productId, @productName, @unitPrice, @quantity, @lineTotal)
        `,
      );
    }

    await transaction.commit();
    return orderId;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = {
  createOrder,
};
