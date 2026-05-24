const express = require("express");
const router = express.Router();
const statsController = require("../controllers/statsController");
const auth = require("../middleware/authMiddleware");

router.get(
  "/",
  auth,
  statsController.getStatsAnalytics
);


module.exports = router;