const {
  getCertificatesService
} = require("../services/certificateService");

exports.getCertificates =
  async (req, res) => {
    try {
      const userId =
        req.user.userId;

      const data =
        await getCertificatesService(
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
          "Failed to fetch certificates"
      });
    }
  };