const progressService = require("../../services/v2/progressService");

const wrap = (label, fn) => async (req, res) => {
  try {
    const data = await fn(req);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`V2 ${label} error:`, error);
    return res.status(500).json({ success: false, message: `Failed to get ${label}` });
  }
};

const clamp = (v, min, max, dflt) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? dflt : Math.min(Math.max(n, min), max);
};

exports.getLeaderboard = wrap("leaderboard", (req) =>
  progressService.getLeaderboard({
    userId: req.user.id,
    limit: clamp(req.query.limit, 1, 100, 20),
    offset: clamp(req.query.offset, 0, 100000, 0),
    search: String(req.query.search || ""),
    goalId: req.query.goalId || null,
  })
);

exports.getPersonalBests = wrap("personal bests", (req) =>
  progressService.getPersonalBests(req.user.id)
);

exports.getLevelsAndBadges = wrap("levels and badges", (req) =>
  progressService.getLevelsAndBadges(req.user.id, {
    days: clamp(req.query.days, 7, 365, 84),
  })
);
