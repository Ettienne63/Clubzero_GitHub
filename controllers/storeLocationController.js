const {
  readStoreLocations,
  writeStoreLocations,
  normalizeStoreLocation,
} = require("../lib/storeLocations");

const sortLocations = (locations) =>
  [...locations].sort((a, b) => {
    const cityCompare = (a.city || "").localeCompare(b.city || "", undefined, {
      sensitivity: "base",
    });
    if (cityCompare !== 0) {
      return cityCompare;
    }
    return (a.name || "").localeCompare(b.name || "", undefined, {
      sensitivity: "base",
    });
  });

exports.getAdminLocationsPage = async (req, res) => {
  let locations = readStoreLocations();
  let needsWrite = false;

  locations = locations.map((location) => {
    if (!location || !location.id) {
      needsWrite = true;
      return normalizeStoreLocation(location || {});
    }
    return normalizeStoreLocation(location, { id: location.id });
  });

  if (needsWrite) {
    writeStoreLocations(locations);
  }

  locations = sortLocations(locations);

  return res.render("admin-store-locations", {
    locations,
    success: req.query.success || null,
    error: req.query.error || null,
    formData: {
      name: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      hours: "",
      phone: "",
      mapUrl: "",
    },
  });
};

exports.createLocation = async (req, res) => {
  const locations = readStoreLocations();
  const location = normalizeStoreLocation(req.body);
  locations.push(location);
  writeStoreLocations(locations);

  return res.redirect("/admin/locations?success=Location+added");
};

exports.updateLocation = async (req, res) => {
  const locationId = (req.params.id || "").toString();
  const locations = readStoreLocations();
  const index = locations.findIndex((location) => location.id === locationId);

  if (index === -1) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "Location not found. Please refresh and try again.",
      )}`,
    );
  }

  const existing = locations[index];
  locations[index] = normalizeStoreLocation(req.body, { id: existing.id });
  writeStoreLocations(locations);

  return res.redirect("/admin/locations?success=Location+updated");
};

exports.deleteLocation = async (req, res) => {
  const locationId = (req.params.id || "").toString();
  const locations = readStoreLocations();
  const nextLocations = locations.filter((location) => location.id !== locationId);

  if (nextLocations.length === locations.length) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "Location not found. Please refresh and try again.",
      )}`,
    );
  }

  writeStoreLocations(nextLocations);
  return res.redirect("/admin/locations?success=Location+removed");
};
