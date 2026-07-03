const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");

router.post(
    "/create-order",
    authMiddleware,
    paymentController.createOrder
);

// routes/payment.routes.js

router.post(
    "/verify",
    authMiddleware,
    paymentController.verifyPayment
);

router.get(
    "/subscription",
    authMiddleware,
    paymentController.getSubscriptionStatus
);

// routes/payment.routes.js

router.get(
    "/plans",
    authMiddleware,
    paymentController.getPlans
);

module.exports = router;