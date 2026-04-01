const jwt = require("jsonwebtoken");

const authMiddleware = (req, res, next) => {

  try {

    const token = req.headers.authorization.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = {
      userId: decoded.id,
    };

    next();

  } catch (error) {

    res.status(401).json({
      error: "Unauthorized"
    });

  }

};

module.exports = authMiddleware;