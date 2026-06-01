const express = require("express");
const router = express.Router();

const teacherAnalyticsController = require("../controllers/teacherAnalyticsController");
const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/dashboard",
  authMiddleware,
  teacherAnalyticsController.getTeacherDashboardAnalytics
);

module.exports = router;

