const {
  readStoreLocations,
  writeStoreLocations,
  normalizeStoreLocation,
} = require("../lib/storeLocations");
const { prisma } = require("../prisma/lib/prisma");

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

const syncSupplierFromLocation = async (location) => {
  const supplierName = (location?.name || "").trim();
  if (!supplierName) {
    return;
  }

  await prisma.supplier.upsert({
    where: { name: supplierName },
    create: {
      name: supplierName,
      contactPhone: location.phone || null,
      notes: [location.city, location.state].filter(Boolean).join(", ") || null,
    },
    update: {
      contactPhone: location.phone || null,
      notes: [location.city, location.state].filter(Boolean).join(", ") || null,
    },
  });
};

const removeSupplierIfOrphanedLocationName = async ({
  locationName,
  locations,
}) => {
  const trimmedName = (locationName || "").trim();
  if (!trimmedName) {
    return;
  }

  const stillUsedByLocation = locations.some(
    (location) => (location?.name || "").trim() === trimmedName,
  );
  if (stillUsedByLocation) {
    return;
  }

  const supplier = await prisma.supplier.findUnique({
    where: { name: trimmedName },
    select: {
      id: true,
      _count: { select: { customProducts: true, stocks: true } },
    },
  });

  if (!supplier) {
    return;
  }

  // Only auto-remove orphan suppliers that have no linked inventory records.
  if (
    Number(supplier?._count?.customProducts || 0) > 0 ||
    Number(supplier?._count?.stocks || 0) > 0
  ) {
    return;
  }

  await prisma.supplier.delete({ where: { id: supplier.id } });
};

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

  try {
    await syncSupplierFromLocation(location);
  } catch (_error) {
    // Keep location creation successful even if supplier sync fails.
  }

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

  try {
    await syncSupplierFromLocation(locations[index]);
    if ((existing?.name || "").trim() !== (locations[index]?.name || "").trim()) {
      await removeSupplierIfOrphanedLocationName({
        locationName: existing?.name,
        locations,
      });
    }
  } catch (_error) {
    // Keep location update successful even if supplier sync fails.
  }

  return res.redirect("/admin/locations?success=Location+updated");
};

exports.deleteLocation = async (req, res) => {
  const locationId = (req.params.id || "").toString();
  const locations = readStoreLocations();
  const deletedLocation = locations.find((location) => location.id === locationId);
  const nextLocations = locations.filter((location) => location.id !== locationId);

  if (nextLocations.length === locations.length) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "Location not found. Please refresh and try again.",
      )}`,
    );
  }

  writeStoreLocations(nextLocations);

  try {
    await removeSupplierIfOrphanedLocationName({
      locationName: deletedLocation?.name,
      locations: nextLocations,
    });
  } catch (_error) {
    // Keep location delete successful even if supplier sync fails.
  }

  return res.redirect("/admin/locations?success=Location+removed");
};
