const express = require("express");

const progressController = require("../../controllers/v2/progressController");
const authMiddleware = require("../../middleware/v2/authMiddleware");

const router = express.Router();

router.get("/leaderboard", authMiddleware, progressController.getLeaderboard);
router.get("/personal-bests", authMiddleware, progressController.getPersonalBests);
router.get("/levels", authMiddleware, progressController.getLevelsAndBadges);

module.exports = router;
