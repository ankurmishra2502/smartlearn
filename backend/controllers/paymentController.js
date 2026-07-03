const paymentService = require("../services/paymentService");

exports.createOrder = async (req, res) => {
    try {
        
        const userId = req.user.userId;

        const { planId } = req.body;

        const result = await paymentService.createOrder(userId, planId);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};

// controllers/payment.controller.js

exports.verifyPayment = async (req, res) => {
    try {

        const userId = req.user.userId;

        const result = await paymentService.verifyPayment(
            userId,
            req.body
        );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (err) {

        console.error(err);

        return res.status(400).json({
            success: false,
            message: err.message
        });

    }
};

exports.getSubscriptionStatus = async (req, res) => {
    try {

        const userId = req.user.userId;

        const result = await paymentService.getSubscriptionStatus(userId);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};


// controllers/payment.controller.js

exports.getPlans = async (req, res) => {
    try {

        const plans = await paymentService.getPlans();

        return res.status(200).json({
            success: true,
            data: plans
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }
};