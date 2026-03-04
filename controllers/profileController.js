const { prisma } = require("../prisma/lib/prisma");

const getUserId = (req) => Number.parseInt(req.session?.user?.id, 10);

const toOptionalText = (value) => {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
};

const parseAddressInput = (body) => ({
  label: toOptionalText(body.label),
  recipientName: (body.recipientName || "").trim(),
  phone: (body.phone || "").trim(),
  addressLine1: (body.addressLine1 || "").trim(),
  addressLine2: toOptionalText(body.addressLine2),
  city: (body.city || "").trim(),
  state: (body.state || "").trim(),
  postalCode: (body.postalCode || "").trim(),
  country: (body.country || "").trim(),
});

const PROFILE_FEATURE_ERROR_QUERY =
  "error=Please+run+Prisma+migration+and+generate+to+enable+address+book";

const hasAddressBookModel = () => Boolean(prisma.addressBookEntry);

const redirectProfileFeatureUnavailable = (res) =>
  res.redirect(`/auth/profile?${PROFILE_FEATURE_ERROR_QUERY}`);

const ensureAddressBookModelAvailable = (res) => {
  if (hasAddressBookModel()) {
    return true;
  }

  redirectProfileFeatureUnavailable(res);
  return false;
};

const getUserProfileById = async (userId) => {
  try {
    return await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        createdAt: true,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error.message === "string" &&
      error.message.includes("Unknown field `phone`")
    ) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
        },
      });

      return user ? { ...user, phone: null } : user;
    }

    throw error;
  }
};

exports.getProfilePage = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const [profile, addressBookEntries] = await Promise.all([
    getUserProfileById(userId),
    hasAddressBookModel()
      ? prisma.addressBookEntry.findMany({
          where: { userId },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        })
      : [],
  ]);

  if (!profile) {
    return res.redirect("/auth/logout");
  }

  return res.render("auth/profile", {
    profile,
    addressBookEntries,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.updateProfile = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  const name = (req.body.name || "").trim();
  const phone = toOptionalText(req.body.phone);

  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        name,
        phone,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error.message === "string" &&
      error.message.includes("Unknown argument `phone`")
    ) {
      await prisma.user.update({
        where: { id: userId },
        data: { name },
      });
    } else {
      throw error;
    }
  }

  if (req.session?.user) {
    req.session.user.name = name;
  }

  return res.redirect(
    "/auth/profile?success=Profile+information+updated+successfully",
  );
};

exports.createAddress = async (req, res) => {
  const userId = getUserId(req);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!ensureAddressBookModelAvailable(res)) {
    return;
  }

  const data = parseAddressInput(req.body);

  await prisma.addressBookEntry.create({
    data: {
      userId,
      ...data,
    },
  });

  return res.redirect("/auth/profile?success=Address+added+to+your+address+book");
};

exports.updateAddress = async (req, res) => {
  const userId = getUserId(req);
  const addressId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!ensureAddressBookModelAvailable(res)) {
    return;
  }

  const existingAddress = await prisma.addressBookEntry.findUnique({
    where: { id: addressId },
    select: { id: true, userId: true },
  });

  if (!existingAddress || existingAddress.userId !== userId) {
    return res.redirect("/auth/profile?error=Address+not+found");
  }

  const data = parseAddressInput(req.body);

  await prisma.addressBookEntry.update({
    where: { id: addressId },
    data,
  });

  return res.redirect("/auth/profile?success=Address+updated+successfully");
};

exports.deleteAddress = async (req, res) => {
  const userId = getUserId(req);
  const addressId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId)) {
    return res.redirect("/auth/login");
  }

  if (!ensureAddressBookModelAvailable(res)) {
    return;
  }

  const existingAddress = await prisma.addressBookEntry.findUnique({
    where: { id: addressId },
    select: { id: true, userId: true },
  });

  if (!existingAddress || existingAddress.userId !== userId) {
    return res.redirect("/auth/profile?error=Address+not+found");
  }

  await prisma.addressBookEntry.delete({
    where: { id: addressId },
  });

  return res.redirect("/auth/profile?success=Address+removed");
};
