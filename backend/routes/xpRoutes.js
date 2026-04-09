const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const xpController = require("../controllers/xpController");

router.post("/activity",authMiddleware, xpController.handleDailyActivity);
router.post("/quiz-complete", xpController.handleQuizCompletion);

router.get("/history",authMiddleware,xpController.getXPHistory);
router.get("/stats",authMiddleware, xpController.getUserStats);
router.get("/global",authMiddleware, xpController.getGlobalRanking);
router.get("/leaderboard",authMiddleware, xpController.getLeaderboard);
router.get("/streaks",authMiddleware, xpController.getStreakDashboard);
router.get("/mybest",authMiddleware, xpController.getMyProgress);
module.exports = router;