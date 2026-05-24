const {
  getStatsAnalyticsService
} = require("../services/statsService");

exports.getStatsAnalytics =
  async (req, res) => {
    try {
      const userId =
        req.user.userId;

      const data =
        await getStatsAnalyticsService(
          userId
        );

      return res.json({
        success: true,
        data
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        success: false,
        message:
          "Failed to fetch stats analytics"
      });
    }
  };