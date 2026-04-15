const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildRetailProfitSummary,
  __test__,
} = require("../lib/retailProfitTracker");

test("parseNumericValue handles common currency formats", () => {
  assert.equal(__test__.parseNumericValue("R 12,345.67"), 12345.67);
  assert.equal(__test__.parseNumericValue("(1,250.50)"), -1250.5);
  assert.equal(__test__.parseNumericValue(""), null);
  assert.equal(__test__.parseNumericValue("abc"), null);
});

test("extractValuesFromText finds revenue and profit lines", () => {
  const extracted = __test__.extractValuesFromText(`
    Total Revenue: R 85,120.00
    Net Profit: R 14,330.25
  `);

  assert.equal(extracted.revenue, 85120);
  assert.equal(extracted.profit, 14330.25);
});

test("buildRetailProfitSummary totals valid numeric entries only", () => {
  const summary = buildRetailProfitSummary({
    entries: [
      { revenue: 1000, profit: 250 },
      { revenue: 500.5, profit: null },
      { revenue: null, profit: 125.75 },
      { revenue: "oops", profit: "oops" },
    ],
  });

  assert.equal(summary.uploadCount, 4);
  assert.equal(summary.totalRevenue, 1500.5);
  assert.equal(summary.totalProfit, 375.75);
});
