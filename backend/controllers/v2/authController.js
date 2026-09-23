const authService = require("../../services/v2/authService");

exports.googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: "Google credential is required",
      });
    }

    const result = await authService.googleLogin(
      credential
    );

    return res.status(200).json({
      success: true,
      message: "Google authentication successful",
      ...result,
    });
  } catch (error) {
    console.error(
      "V2 GOOGLE AUTH ERROR:",
      error
    );

    return res.status(401).json({
      success: false,
      message: "Google authentication failed",
    });
  }
};

exports.emailLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const result = await authService.emailLogin(
      email.trim(),
      password
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      ...result,
    });
  } catch (error) {
    console.error(
      "V2 EMAIL LOGIN ERROR:",
      error
    );

    if (
      error.message === "INVALID_CREDENTIALS"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (
      error.message === "PASSWORD_NOT_SET"
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Password login is not available for this account",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
};