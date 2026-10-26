const CreditPackage = require("../models/CreditPackage");
const Payment = require("../models/Payment");
const {
    getAccount,
    listPackages,
    createOrder,
    verifyPayment,
} = require("../services/paymentService");

const getPaymentAccount = async (req, res) => {
    try {
        const account = await getAccount(req.userId);
        return res.json({ success: true, ...account });
    } catch (error) {
        console.error("Get payment account error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to load trip credits and payment history.",
        });
    }
};

const getCreditPackages = async (req, res) => {
    try {
        const packages = await listPackages();
        return res.json({ success: true, packages });
    } catch (error) {
        console.error("Get credit packages error:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load trip packages." });
    }
};

const createPaymentOrder = async (req, res) => {
    try {
        const order = await createOrder({ userId: req.userId, packageKey: req.body?.packageKey });
        return res.status(201).json({ success: true, ...order });
    } catch (error) {
        console.error("Create Razorpay test order error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to create a Razorpay test order.",
        });
    }
};

const verifyPaymentCallback = async (req, res) => {
    try {
        const result = await verifyPayment({
            userId: req.userId,
            orderId: req.body?.razorpay_order_id,
            paymentId: req.body?.razorpay_payment_id,
            signature: req.body?.razorpay_signature,
        });
        return res.json(result);
    } catch (error) {
        console.error("Razorpay test payment verification error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to verify the payment.",
        });
    }
};

const updateCreditPackage = async (req, res) => {
    try {
        const amountPaise = Number(req.body.amountPaise);
        if (!Number.isSafeInteger(amountPaise) || amountPaise < 100 || amountPaise > 100000000) {
            return res.status(400).json({
                success: false,
                message: "Package price must be between ₹1 and ₹1,000,000, entered in paise.",
            });
        }
        if (req.body.active !== undefined && typeof req.body.active !== "boolean") {
            return res.status(400).json({ success: false, message: "Package active must be true or false." });
        }

        const updates = { amountPaise };
        if (req.body.active !== undefined) updates.active = req.body.active;
        const updatedPackage = await CreditPackage.findByIdAndUpdate(
            req.params.id,
            { $set: updates },
            { new: true, runValidators: true }
        );
        if (!updatedPackage) {
            return res.status(404).json({ success: false, message: "Credit package not found." });
        }

        return res.json({ success: true, package: updatedPackage });
    } catch (error) {
        console.error("Update credit package error:", error.message);
        if (error.name === "ValidationError" || error.name === "CastError") {
            return res.status(400).json({ success: false, message: error.message });
        }
        return res.status(500).json({ success: false, message: "Unable to update package pricing." });
    }
};

const getPaymentAdminData = async () => {
    const [packages, payments, revenue] = await Promise.all([
        listPackages({ includeInactive: true }),
        Payment.find()
            .populate("user", "name email")
            .sort({ createdAt: -1 })
            .limit(500)
            .lean(),
        Payment.aggregate([
            { $match: { status: "paid", currency: "INR" } },
            { $group: { _id: null, revenuePaise: { $sum: "$amountPaise" }, paidPaymentCount: { $sum: 1 } } },
        ]),
    ]);
    return {
        packages,
        payments,
        revenuePaise: revenue[0]?.revenuePaise || 0,
        paidPaymentCount: revenue[0]?.paidPaymentCount || 0,
    };
};

module.exports = {
    getPaymentAccount,
    getCreditPackages,
    createPaymentOrder,
    verifyPaymentCallback,
    updateCreditPackage,
    getPaymentAdminData,
};
