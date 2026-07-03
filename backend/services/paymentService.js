const razorpay = require("../config/razorpay");
const db = require("../config/db"); // use your postgres connection
const crypto = require("crypto");

exports.createOrder = async (userId, planId) => {

    // 1. Fetch plan
    const planResult = await db.query(
        `
        SELECT *
        FROM subscription_plans
        WHERE id = $1
        AND is_active = true
        `,
        [planId]
    );

    if (planResult.rows.length === 0) {
        throw new Error("Subscription plan not found");
    }

    const plan = planResult.rows[0];

    // 2. Create Razorpay Order

    const order = await razorpay.orders.create({

        amount: Math.round(plan.price * 100),

        currency: "INR",

        receipt: `receipt_${Date.now()}`
    });

    // 3. Save Pending Payment

    await db.query(
    `
    INSERT INTO payments
    (
        user_id,
        plan_id,
        amount,
        currency,
        status,
        razorpay_order_id
    )
    VALUES
    (
        $1,$2,$3,$4,$5,$6
    )
    `,
    [
        userId,
        plan.id,
        plan.price,
        "INR",
        "PENDING",
        order.id
    ]
);

    // 4. Return order

    return {

        orderId: order.id,

        amount: order.amount,

        currency: order.currency,

        razorpayKey: process.env.RAZORPAY_KEY_ID
    };
};

exports.verifyPayment = async (userId, paymentData) => {

    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    } = paymentData;

    // 1. Verify Razorpay Signature

    const generatedSignature = crypto
        .createHmac(
            "sha256",
            process.env.RAZORPAY_KEY_SECRET
        )
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");

    if (generatedSignature !== razorpay_signature) {
        throw new Error("Invalid payment signature");
    }

    // Get PostgreSQL Client

    const client = await db.connect();

    try {

        await client.query("BEGIN");

        // --------------------------------------------------
        // 2. Fetch Payment
        // --------------------------------------------------

        const paymentResult = await client.query(
            `
            SELECT *
            FROM payments
            WHERE razorpay_order_id = $1
            `,
            [razorpay_order_id]
        );

        if (paymentResult.rows.length === 0) {
            throw new Error("Payment not found");
        }

        const payment = paymentResult.rows[0];

        // --------------------------------------------------
        // 3. Validate User
        // --------------------------------------------------

        if (payment.user_id !== userId) {
            throw new Error("Unauthorized payment");
        }

        // --------------------------------------------------
        // 4. Prevent Duplicate Verification
        // --------------------------------------------------

        if (payment.status === "SUCCESS") {
            throw new Error("Payment already verified");
        }

        // --------------------------------------------------
        // 5. Update Payment
        // --------------------------------------------------

        await client.query(
            `
            UPDATE payments
            SET
                status = 'SUCCESS',
                razorpay_payment_id = $1,
                razorpay_signature = $2
            WHERE razorpay_order_id = $3
            `,
            [
                razorpay_payment_id,
                razorpay_signature,
                razorpay_order_id
            ]
        );

        // --------------------------------------------------
        // 6. Fetch Subscription Plan
        // --------------------------------------------------

        const planResult = await client.query(
            `
            SELECT *
            FROM subscription_plans
            WHERE id = $1
            `,
            [payment.plan_id]
        );

        if (planResult.rows.length === 0) {
            throw new Error("Subscription plan not found");
        }

        const plan = planResult.rows[0];

        // --------------------------------------------------
        // 7. Calculate Expiry
        // --------------------------------------------------

        const startDate = new Date();

        const endDate = new Date();

        endDate.setDate(
            endDate.getDate() + plan.duration_days
        );

        // --------------------------------------------------
        // 8. Create Subscription
        // --------------------------------------------------

        const subscriptionResult = await client.query(
            `
            INSERT INTO user_subscriptions
            (
                user_id,
                plan_id,
                start_date,
                end_date,
                status
            )
            VALUES
            (
                $1,$2,$3,$4,'ACTIVE'
            )
            RETURNING id
            `,
            [
                userId,
                payment.plan_id,
                startDate,
                endDate
            ]
        );

        const subscriptionId =
            subscriptionResult.rows[0].id;

        // --------------------------------------------------
        // 9. Update Payment with Subscription ID
        // --------------------------------------------------

        await client.query(
            `
            UPDATE payments
            SET subscription_id = $1
            WHERE razorpay_order_id = $2
            `,
            [
                subscriptionId,
                razorpay_order_id
            ]
        );

        // --------------------------------------------------
        // 10. Update User
        // --------------------------------------------------

        await client.query(
            `
            UPDATE users
            SET
                is_premium = TRUE,
                current_plan = $1,
                premium_expiry = $2
            WHERE id = $3
            `,
            [
                plan.billing_cycle,
                endDate,
                userId
            ]
        );

        // --------------------------------------------------
        // Commit
        // --------------------------------------------------

        await client.query("COMMIT");

        return {
            subscriptionId,
            premiumExpiry: endDate
        };

    } catch (err) {

        await client.query("ROLLBACK");

        throw err;

    } finally {

        client.release();

    }

};


exports.getSubscriptionStatus = async (userId) => {

    const result = await db.query(
        `
        SELECT
            is_premium,
            current_plan,
            premium_expiry
        FROM users
        WHERE id = $1
        `,
        [userId]
    );

    if (result.rows.length === 0) {
        throw new Error("User not found");
    }

    const user = result.rows[0];

    // If user is not premium
    if (!user.is_premium) {
        return {
            isPremium: false,
            currentPlan: null,
            expiryDate: null
        };
    }

    const now = new Date();
    const expiryDate = new Date(user.premium_expiry);

    // Check expiry
    if (expiryDate <= now) {

        // Expire premium automatically
        await db.query(
            `
            UPDATE users
            SET
                is_premium = FALSE,
                current_plan = NULL,
                premium_expiry = NULL
            WHERE id = $1
            `,
            [userId]
        );

        await db.query(
            `
            UPDATE user_subscriptions
            SET status = 'EXPIRED'
            WHERE user_id = $1
              AND status = 'ACTIVE'
            `,
            [userId]
        );

        return {
            isPremium: false,
            currentPlan: null,
            expiryDate: null
        };
    }

    return {
        isPremium: true,
        currentPlan: user.current_plan,
        expiryDate: user.premium_expiry
    };

};

// services/payment.service.js

exports.getPlans = async () => {

    const result = await db.query(
        `
        SELECT
            id,
            name,
            price,
            billing_cycle,
            duration_days
        FROM subscription_plans
        WHERE is_active = TRUE
        ORDER BY price ASC
        `
    );

    return result.rows;

};