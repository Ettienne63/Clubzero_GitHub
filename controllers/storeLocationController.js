const {
  normalizeStoreLocation,
} = require("../lib/storeLocations");
const { prisma } = require("../prisma/lib/prisma");

const mapDbLocationToView = (location) => ({
  id: location.id,
  name: location.name,
  addressLine1: location.addressLine1,
  addressLine2: location.addressLine2,
  city: location.city,
  state: location.state,
  hours: location.hours,
  phone: location.phone,
  mapUrl: location.mapUrl,
});

const mapNormalizedLocationToDb = (location) => ({
  id: location.id,
  name: location.name,
  addressLine1: location.addressLine1,
  addressLine2: location.addressLine2,
  city: location.city,
  state: location.state,
  hours: location.hours,
  phone: location.phone,
  mapUrl: location.mapUrl,
});

const findLocationByName = async (name, excludeId = null) => {
  const normalizedName = (name || "").toString().trim();
  if (!normalizedName) {
    return null;
  }

  return prisma.storeLocation.findFirst({
    where: {
      name: {
        equals: normalizedName,
        mode: "insensitive",
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, name: true },
  });
};

const syncSupplierFromLocation = async (location) => {
  const locationId = (location?.id || "").toString().trim();
  const supplierName = (location?.name || "").trim();
  if (!locationId || !supplierName) {
    return;
  }

  const normalizedPhone = location.phone || null;
  const normalizedNotes =
    [location.city, location.state].filter(Boolean).join(", ") || null;

  const existingByLocation = await prisma.supplier.findUnique({
    where: { storeLocationId: locationId },
    select: { id: true },
  });

  if (existingByLocation) {
    await prisma.supplier.update({
      where: { id: existingByLocation.id },
      data: {
        name: supplierName,
        isActive: true,
        contactPhone: normalizedPhone,
        notes: normalizedNotes,
      },
    });
    return;
  }

  const existingByName = await prisma.supplier.findUnique({
    where: { name: supplierName },
    select: { id: true },
  });

  if (existingByName) {
    await prisma.supplier.update({
      where: { id: existingByName.id },
      data: {
        storeLocationId: locationId,
        isActive: true,
        contactPhone: normalizedPhone,
        notes: normalizedNotes,
      },
    });
    return;
  }

  await prisma.supplier.create({
    data: {
      name: supplierName,
      storeLocationId: locationId,
      isActive: true,
      contactPhone: normalizedPhone,
      notes: normalizedNotes,
    },
  });
};

const removeSupplierIfOrphanedLocationName = async ({
  locationId,
}) => {
  const trimmedLocationId = (locationId || "").trim();
  if (!trimmedLocationId) {
    return;
  }

  const stillExistingLocation = await prisma.storeLocation.count({
    where: { id: trimmedLocationId },
  });
  if (stillExistingLocation > 0) {
    return;
  }

  const supplier = await prisma.supplier.findUnique({
    where: { storeLocationId: trimmedLocationId },
    select: { id: true },
  });

  if (!supplier) {
    return;
  }

  await prisma.supplier.update({
    where: { id: supplier.id },
    data: {
      isActive: false,
      storeLocationId: null,
    },
  });
};

exports.getAdminLocationsPage = async (req, res) => {
  const dbLocations = await prisma.storeLocation.findMany({
    orderBy: [{ city: "asc" }, { name: "asc" }],
  });
  const locations = dbLocations.map(mapDbLocationToView);

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
  const location = normalizeStoreLocation(req.body || {});
  const duplicateByName = await findLocationByName(location.name);
  if (duplicateByName) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "A store location with this name already exists.",
      )}`,
    );
  }

  await prisma.storeLocation.create({
    data: mapNormalizedLocationToDb(location),
  });

  try {
    await syncSupplierFromLocation(location);
  } catch (_error) {
    // Keep location creation successful even if supplier sync fails.
  }

  return res.redirect("/admin/locations?success=Location+added");
};

exports.updateLocation = async (req, res) => {
  const locationId = (req.params.id || "").toString();
  const existing = await prisma.storeLocation.findUnique({
    where: { id: locationId },
  });

  if (!existing) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "Location not found. Please refresh and try again.",
      )}`,
    );
  }

  const next = normalizeStoreLocation(req.body || {}, { id: existing.id });
  const duplicateByName = await findLocationByName(next.name, existing.id);
  if (duplicateByName) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "A store location with this name already exists.",
      )}`,
    );
  }

  await prisma.storeLocation.update({
    where: { id: existing.id },
    data: mapNormalizedLocationToDb(next),
  });

  try {
    await syncSupplierFromLocation(next);
    if ((existing?.name || "").trim() !== (next?.name || "").trim()) {
      await removeSupplierIfOrphanedLocationName({
        locationId: existing?.id,
      });
    }
  } catch (_error) {
    // Keep location update successful even if supplier sync fails.
  }

  return res.redirect("/admin/locations?success=Location+updated");
};

exports.deleteLocation = async (req, res) => {
  const locationId = (req.params.id || "").toString();
  const deletedLocation = await prisma.storeLocation.findUnique({
    where: { id: locationId },
  });

  if (!deletedLocation) {
    return res.redirect(
      `/admin/locations?error=${encodeURIComponent(
        "Location not found. Please refresh and try again.",
      )}`,
    );
  }

  await prisma.storeLocation.delete({ where: { id: locationId } });

  try {
    await removeSupplierIfOrphanedLocationName({
      locationId: deletedLocation?.id,
    });
  } catch (_error) {
    // Keep location delete successful even if supplier sync fails.
  }

  return res.redirect("/admin/locations?success=Location+removed");
};
