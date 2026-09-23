const express = require("express");

const router = express.Router();

const onboardingController = require("../../controllers/v2/onboardingController");
const authenticateV2 = require("../../middleware/v2/authMiddleware");

router.post(
  "/personal",
  authenticateV2,
  onboardingController.savePersonalInformation
);

router.post(
  "/academic",
  authenticateV2,
  onboardingController.saveAcademicInformation
);

router.get(
  "/goals",
  authenticateV2,
  onboardingController.getGoals
);

router.post(
  "/goals",
  authenticateV2,
  onboardingController.saveGoal
);

router.get(
  "/subjects",
  authenticateV2,
  onboardingController.getSubjects
);


module.exports = router;