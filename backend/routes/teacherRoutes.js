const express = require("express");
const router = express.Router();

const teacherController = require("../controllers/teacherController");

const authMiddleware = require("../middleware/authMiddleware");

router.post("/admin/create-teacher", teacherController.createTeacher);

router.post("/auth/teacher-login", teacherController.teacherLogin);

router.post("/auth/change-password", authMiddleware, teacherController.changePassword);

router.post("/auth/forgot-password", teacherController.forgotPassword);

router.post("/auth/verify-otp", teacherController.verifyOtp);

router.post("/auth/reset-password", teacherController.resetPassword);

module.exports = router;