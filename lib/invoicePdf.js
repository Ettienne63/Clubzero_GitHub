const PDFDocument = require("pdfkit");

const currency = (value) => `R${Number(value || 0).toFixed(2)}`;

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-ZA") : "-";

const renderInvoicePdf = ({ invoice, order }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(24).text("Club Zero Invoice", { align: "left" });
    doc.moveDown(0.25);
    doc.fontSize(12).fillColor("#666666").text(`Invoice ${invoice.invoiceNumber}`);
    doc.text(`Order #${order.id}`);
    doc.text(`Status: ${invoice.status}`);
    doc.moveDown();

    doc.fillColor("#000000");
    doc.fontSize(11).text("From", { underline: true });
    doc.text("Club Zero");
    doc.text("South Africa");
    doc.moveDown();

    doc.text("Bill To", { underline: true });
    doc.text(invoice.recipientName);
    doc.text(invoice.recipientEmail);
    doc.text(order.deliveryPhone);
    doc.moveDown();

    doc.text(`Issued: ${formatDate(invoice.issuedAt)}`);
    doc.moveDown();

    const descriptionX = 48;
    const qtyX = 300;
    const unitX = 370;
    const totalX = 470;

    doc.fontSize(11).text("Description", descriptionX, doc.y, { width: 220 });
    doc.text("Cases", qtyX, doc.y - 12, { width: 50, align: "right" });
    doc.text("Unit", unitX, doc.y - 12, { width: 80, align: "right" });
    doc.text("Subtotal", totalX, doc.y - 12, { width: 80, align: "right" });
    doc.moveDown(0.5);
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.5);

    order.orderItems.forEach((item) => {
      const lineY = doc.y;
      const customEntries = Array.isArray(item.customPackConfig)
        ? item.customPackConfig
        : [];
      const customText =
        item.isCustomPack && customEntries.length
          ? customEntries
              .map((entry) => `${entry.productName || "Flavour"} (${entry.bottlesPerPack})`)
              .join(", ")
          : "";
      doc.fillColor("#000000").text(item.productName, descriptionX, lineY, {
        width: 220,
      });
      doc
        .fillColor("#666666")
        .fontSize(9)
        .text(`${item.quantity * 12} bottles`, descriptionX, lineY + 14, {
          width: 220,
        });
      if (customText) {
        doc.text(customText, descriptionX, lineY + 26, {
          width: 220,
        });
      }
      doc
        .fillColor("#000000")
        .fontSize(11)
        .text(String(item.quantity), qtyX, lineY, { width: 50, align: "right" });
      doc.text(currency(item.productPrice), unitX, lineY, {
        width: 80,
        align: "right",
      });
      doc.text(currency(item.subtotal), totalX, lineY, {
        width: 80,
        align: "right",
      });
      doc.moveDown(customText ? 2.3 : 1.8);
    });

    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown();

    doc.fontSize(11).fillColor("#000000");
    doc.text(`Subtotal: ${currency(invoice.subtotal)}`, 360, doc.y, {
      width: 180,
      align: "right",
    });
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").text(`Total: ${currency(invoice.total)}`, 360, doc.y, {
      width: 180,
      align: "right",
    });
    doc.font("Helvetica");
    doc.moveDown(1.5);

    doc.text("Delivery Address", { underline: true });
    doc.text(order.deliveryName);
    doc.text(order.deliveryAddressLine1);
    if (order.deliveryAddressLine2) {
      doc.text(order.deliveryAddressLine2);
    }
    doc.text(
      `${order.deliveryCity}, ${order.deliveryState} ${order.deliveryPostalCode}`,
    );
    doc.text(order.deliveryCountry);
    doc.moveDown();

    doc.text("Notes", { underline: true });
    doc.text(invoice.notes || "No notes.");
    doc.moveDown(0.5);
    doc
      .fillColor("#666666")
      .fontSize(9)
      .text(
        `Use ${invoice.invoiceNumber} as the payment reference for manual payments.`,
      );

    doc.end();
  });

module.exports = { renderInvoicePdf };
