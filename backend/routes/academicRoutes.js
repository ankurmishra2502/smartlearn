const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const academicController = require("../controllers/academicController");

router.post(
  "/admin/schools",
  authMiddleware,
  academicController.createSchool
);

router.post(
  "/admin/classes",
  authMiddleware,
  academicController.createClass
);



router.get(
  "/student/schools",
  academicController.getSchools
);

router.get(
  "/student/classes",
  academicController.getClasses
);

router.get(
  "/student/profile",
  authMiddleware,
  academicController.getStudentProfile
);

module.exports = router;