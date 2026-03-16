const fs = require("fs");
const path = require("path");

const storeLocationsPath = path.join(
  __dirname,
  "..",
  "config",
  "store-locations.json",
);

const readStoreLocations = () => {
  try {
    const raw = fs.readFileSync(storeLocationsPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const writeStoreLocations = (locations) => {
  fs.writeFileSync(storeLocationsPath, JSON.stringify(locations, null, 2));
};

const toOptionalText = (value) => {
  const trimmed = (value || "").toString().trim();
  return trimmed ? trimmed : null;
};

const normalizeStoreLocation = (input, options = {}) => {
  const name = (input.name || "").toString().trim();
  const addressLine1 = (input.addressLine1 || "").toString().trim();
  const addressLine2 = toOptionalText(input.addressLine2);
  const city = (input.city || "").toString().trim();
  const state = toOptionalText(input.state);
  const hours = toOptionalText(input.hours);
  const phone = toOptionalText(input.phone);
  const mapUrl = toOptionalText(input.mapUrl);
  const id =
    options.id ||
    input.id ||
    `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id: id.toString(),
    name,
    addressLine1,
    addressLine2,
    city,
    state,
    hours,
    phone,
    mapUrl,
  };
};

module.exports = {
  readStoreLocations,
  writeStoreLocations,
  normalizeStoreLocation,
};
