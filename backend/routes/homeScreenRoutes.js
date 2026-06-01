const express = require("express");
const router = express.Router();

const studentDashboardController = require("../controllers/homeScreen");
const authMiddleware = require("../middleware/authMiddleware");

router.get(
  "/overview",
  authMiddleware,
  studentDashboardController.getStudentDashboardOverview
);

module.exports = router;