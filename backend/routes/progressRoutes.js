const express = require('express');
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { getProgressSummary, getDashboard, getAnalytics, getCertificates} = require('../controllers/progressController');

// GET /progress/summary
router.get('/summary', auth, getProgressSummary);

// GET /progress/dashboard
router.get('/dashboard', auth, getDashboard);

// GET /progress/analytics
router.get('/analytics', auth, getAnalytics);

// GET /progress/certificates
router.get('/certificates', auth, getCertificates);

module.exports = router;