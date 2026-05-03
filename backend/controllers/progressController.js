const db = require('../config/db');
const { getProgressSummaryService, getDashboardService, getAnalyticsService, getCertificatesService } = require('../services/progressService');

const getProgressSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
   

    const result = await getProgressSummaryService(userId);

    return res.status(200).json({
      success: true,
      data: result,
    });

  } catch (error) {
    console.error('Progress Summary Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch progress summary',
    });
  }
};
const getDashboard = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID required"
      });
    }

    const data = await getDashboardService(userId);

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard"
    });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID required"
      });
    }

    const data = await getAnalyticsService(userId);

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("Analytics Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics"
    });
  }
};


const getCertificates = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID required"
      });
    }

    const data = await getCertificatesService(userId);

    res.json({
      success: true,
      data
    });

  } catch (err) {
    console.error("Certificates Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch certificates"
    });
  }
};

module.exports = {
  getProgressSummary,
  getDashboard,
  getAnalytics,
  getCertificates
};