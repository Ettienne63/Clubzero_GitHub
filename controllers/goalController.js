const { prisma } = require("../prisma/lib/prisma");

const GOAL_TRACKER_EMAIL_SUFFIX = "@clubzero.co.za";
const BOTTLES_PER_CASE = 12;

const normalizeEmail = (value) => (value || "").toString().trim().toLowerCase();
const getUsernameFromEmail = (email) => normalizeEmail(email).split("@")[0] || "";

const canAccessGoalTracker = (req) =>
  Boolean(req.session?.user?.isAdmin) ||
  normalizeEmail(req.session?.user?.email).endsWith(GOAL_TRACKER_EMAIL_SUFFIX);

const redirectGoalTrackerDenied = (res) =>
  res.redirect(
    `/auth/products?error=${encodeURIComponent("You are not allowed to access the goal tracker.")}`,
  );

const getTotalBottlesSold = async () => {
  const totals = await prisma.orderItem.aggregate({
    where: {
      order: { status: "PAID" },
    },
    _sum: { quantity: true },
  });

  return Number(totals._sum.quantity || 0) * BOTTLES_PER_CASE;
};

const getCreatorUsername = (goal) => {
  const creatorName = (goal.createdBy?.name || "").trim();
  return creatorName || getUsernameFromEmail(goal.createdBy?.email) || "unknown";
};

exports.getGoalsPage = async (req, res) => {
  if (!canAccessGoalTracker(req)) {
    return redirectGoalTrackerDenied(res);
  }

  const [goals, totalBottlesSold] = await Promise.all([
    prisma.goal.findMany({
      include: {
        createdBy: {
          select: { name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getTotalBottlesSold(),
  ]);

  const goalsWithProgress = goals.map((goal) => {
    const creatorUsername = getCreatorUsername(goal);
    const progressPercent =
      goal.targetBottles > 0
        ? Math.min((totalBottlesSold / goal.targetBottles) * 100, 100)
        : 0;

    return {
      ...goal,
      isReached: totalBottlesSold >= goal.targetBottles,
      remainingBottles: Math.max(goal.targetBottles - totalBottlesSold, 0),
      progressPercent: Number(progressPercent.toFixed(1)),
      creatorUsername,
    };
  });

  const goalsByCreatorMap = goalsWithProgress.reduce((acc, goal) => {
    const key = goal.creatorUsername;
    if (!acc[key]) {
      acc[key] = {
        creatorUsername: key,
        goals: [],
      };
    }
    acc[key].goals.push(goal);
    return acc;
  }, {});

  const goalsByCreator = Object.values(goalsByCreatorMap).sort((a, b) =>
    a.creatorUsername.localeCompare(b.creatorUsername),
  );

  return res.render("goals", {
    goals: goalsWithProgress,
    goalsByCreator,
    totalBottlesSold,
    success: req.query.success || null,
    error: req.query.error || null,
  });
};

exports.createGoal = async (req, res) => {
  if (!canAccessGoalTracker(req)) {
    return redirectGoalTrackerDenied(res);
  }

  const title = (req.body.title || "").trim();
  const targetBottles = Number.parseInt(req.body.targetBottles, 10);
  const createdByUserId = Number.parseInt(req.session?.user?.id, 10);

  if (!title || !Number.isInteger(targetBottles) || targetBottles < 1) {
    return res.redirect(
      `/auth/goals?error=${encodeURIComponent("Please provide a valid goal title and target bottles.")}`,
    );
  }

  if (!Number.isInteger(createdByUserId)) {
    return res.redirect("/auth/login");
  }

  await prisma.goal.create({
    data: {
      title,
      targetBottles,
      createdByUserId,
    },
  });

  return res.redirect(
    `/auth/goals?success=${encodeURIComponent("Goal added successfully.")}`,
  );
};

exports.getEditGoalPage = async (req, res) => {
  if (!canAccessGoalTracker(req)) {
    return redirectGoalTrackerDenied(res);
  }

  const goalId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(goalId)) {
    return res.redirect("/auth/goals?error=Invalid+goal+id");
  }

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    include: {
      createdBy: {
        select: { name: true, email: true },
      },
    },
  });

  if (!goal) {
    return res.redirect("/auth/goals?error=Goal+not+found");
  }

  return res.render("goals-edit", {
    goal: {
      ...goal,
      creatorUsername: getCreatorUsername(goal),
    },
    error: req.query.error || null,
  });
};

exports.updateGoal = async (req, res) => {
  if (!canAccessGoalTracker(req)) {
    return redirectGoalTrackerDenied(res);
  }

  const goalId = Number.parseInt(req.params.id, 10);
  const title = (req.body.title || "").trim();
  const targetBottles = Number.parseInt(req.body.targetBottles, 10);

  if (!Number.isInteger(goalId)) {
    return res.redirect("/auth/goals?error=Invalid+goal+id");
  }

  if (!title || !Number.isInteger(targetBottles) || targetBottles < 1) {
    return res.redirect(
      `/auth/goals/${goalId}/edit?error=${encodeURIComponent("Please provide a valid goal title and target bottles.")}`,
    );
  }

  const existingGoal = await prisma.goal.findUnique({
    where: { id: goalId },
    select: { id: true },
  });

  if (!existingGoal) {
    return res.redirect("/auth/goals?error=Goal+not+found");
  }

  await prisma.goal.update({
    where: { id: goalId },
    data: {
      title,
      targetBottles,
    },
  });

  return res.redirect(
    `/auth/goals?success=${encodeURIComponent("Goal updated successfully.")}`,
  );
};

exports.deleteGoal = async (req, res) => {
  if (!canAccessGoalTracker(req)) {
    return redirectGoalTrackerDenied(res);
  }

  const goalId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(goalId)) {
    return res.redirect("/auth/goals?error=Invalid+goal+id");
  }

  try {
    await prisma.goal.delete({
      where: { id: goalId },
    });
    return res.redirect(
      `/auth/goals?success=${encodeURIComponent("Goal deleted successfully.")}`,
    );
  } catch (error) {
    if (error?.code === "P2025") {
      return res.redirect("/auth/goals?error=Goal+not+found");
    }
    return res.redirect("/auth/goals?error=Unable+to+delete+goal");
  }
};
