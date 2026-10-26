const crypto = require("crypto");
const Razorpay = require("razorpay");
const User = require("../models/User");
const Payment = require("../models/Payment");
const CreditPackage = require("../models/CreditPackage");

const DEFAULT_PACKAGES = [
    { key: "one-trip", name: "1 AI trip", credits: 1, amountPaise: 8900, currency: "INR", active: true, sortOrder: 1 },
    { key: "two-trips", name: "2 AI trips", credits: 2, amountPaise: 14900, currency: "INR", active: true, sortOrder: 2 },
    { key: "ten-trips", name: "10 AI trips", credits: 10, amountPaise: 59900, currency: "INR", active: true, sortOrder: 3 },
];

const createServiceError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const getRazorpayCredentials = () => {
    const keyId = process.env.RAZORPAY_KEY_ID?.trim();
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (!keyId || !keySecret || keyId.startsWith("rzp_test_your_") || keySecret === "your_razorpay_test_key_secret") {
        throw createServiceError("Razorpay Test Mode is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend/.env.", 503);
    }
    if (process.env.RAZORPAY_MODE === "live" || !keyId.startsWith("rzp_test_")) {
        throw createServiceError("This payment system only accepts Razorpay Test Mode credentials.", 503);
    }
    return { keyId, keySecret };
};

const safeEqualHex = (expected, supplied) => {
    if (typeof supplied !== "string" || !/^[a-f\d]{64}$/i.test(supplied)) return false;
    const expectedBuffer = Buffer.from(expected, "hex");
    const suppliedBuffer = Buffer.from(supplied, "hex");
    return expectedBuffer.length === suppliedBuffer.length
        && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
};

const createPaymentService = ({
    UserModel = User,
    PaymentModel = Payment,
    CreditPackageModel = CreditPackage,
    gatewayFactory = (credentials) => new Razorpay({
        key_id: credentials.keyId,
        key_secret: credentials.keySecret,
    }),
    credentialsFactory = getRazorpayCredentials,
} = {}) => {
    const ensureDefaultPackages = async () => {
        await Promise.all(DEFAULT_PACKAGES.map((packageDetails) => CreditPackageModel.updateOne(
            { key: packageDetails.key },
            { $setOnInsert: packageDetails },
            { upsert: true, setDefaultsOnInsert: true }
        )));
    };

    const listPackages = async ({ includeInactive = false } = {}) => {
        await ensureDefaultPackages();
        const filter = includeInactive ? {} : { active: true };
        return CreditPackageModel.find(filter).sort({ sortOrder: 1 }).lean();
    };

    const getAccount = async (userId) => {
        const [user, packages, payments] = await Promise.all([
            UserModel.findById(userId).select("freeTripUsed tripCredits"),
            listPackages(),
            PaymentModel.find({ user: userId })
                .select("packageName credits amountPaise currency status razorpayOrderId razorpayPaymentId paidAt createdAt")
                .sort({ createdAt: -1 })
                .limit(50)
                .lean(),
        ]);
        if (!user) throw createServiceError("User account not found.", 404);
        return {
            freeTripAvailable: user.freeTripUsed !== true,
            tripCredits: Number(user.tripCredits) || 0,
            packages,
            payments,
        };
    };

    const getTripAvailability = async (userId) => {
        const user = await UserModel.findById(userId).select("freeTripUsed tripCredits");
        if (!user) throw createServiceError("User account not found.", 404);
        return {
            freeTripAvailable: user.freeTripUsed !== true,
            tripCredits: Number(user.tripCredits) || 0,
        };
    };

    const createOrder = async ({ userId, packageKey }) => {
        if (typeof packageKey !== "string" || !packageKey.trim()) {
            throw createServiceError("Select a valid trip package.", 400);
        }
        const credentials = credentialsFactory();
        await ensureDefaultPackages();
        const selectedPackage = await CreditPackageModel.findOne({ key: packageKey.trim(), active: true }).lean();
        if (!selectedPackage) throw createServiceError("This trip package is not available.", 404);

        const receipt = `tripai_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
        const order = await gatewayFactory(credentials).orders.create({
            amount: selectedPackage.amountPaise,
            currency: "INR",
            receipt,
            notes: { packageKey: selectedPackage.key },
        });
        if (
            !order?.id
            || order.amount !== selectedPackage.amountPaise
            || order.currency !== "INR"
        ) {
            throw createServiceError("Razorpay returned an invalid test order.", 502);
        }

        const payment = await PaymentModel.create({
            user: userId,
            creditPackage: selectedPackage._id,
            packageKey: selectedPackage.key,
            packageName: selectedPackage.name,
            credits: selectedPackage.credits,
            amountPaise: selectedPackage.amountPaise,
            currency: "INR",
            razorpayOrderId: order.id,
            status: "pending",
        });

        return {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: credentials.keyId,
            paymentId: payment._id,
            packageName: selectedPackage.name,
            credits: selectedPackage.credits,
            testMode: true,
        };
    };

    const verifyPayment = async ({ userId, orderId, paymentId, signature }) => {
        if (![orderId, paymentId, signature].every((value) => typeof value === "string" && value.trim())) {
            throw createServiceError("Payment order, payment ID, and signature are required.", 400);
        }
        const payment = await PaymentModel.findOne({ user: userId, razorpayOrderId: orderId });
        if (!payment) throw createServiceError("Payment order not found for this account.", 404);

        const credentials = credentialsFactory();
        const expectedSignature = crypto
            .createHmac("sha256", credentials.keySecret)
            .update(`${orderId}|${paymentId}`)
            .digest("hex");
        if (!safeEqualHex(expectedSignature, signature)) {
            throw createServiceError("Razorpay payment signature verification failed.", 400);
        }

        if (payment.status === "paid" && payment.razorpayPaymentId !== paymentId) {
            throw createServiceError("A different payment is already associated with this order.", 409);
        }

        if (payment.status !== "paid") {
            const verifiedPayment = await gatewayFactory(credentials).payments.fetch(paymentId);
            if (
                verifiedPayment.status !== "captured"
                || verifiedPayment.order_id !== payment.razorpayOrderId
                || verifiedPayment.amount !== payment.amountPaise
                || verifiedPayment.currency !== payment.currency
            ) {
                throw createServiceError("Payment is not captured or its amount does not match the order.", 400);
            }
            if (payment.razorpayPaymentId && payment.razorpayPaymentId !== paymentId) {
                throw createServiceError("A different payment is already associated with this order.", 409);
            }

            const claimResult = await PaymentModel.updateOne(
                {
                    _id: payment._id,
                    status: { $ne: "paid" },
                    $or: [
                        { razorpayPaymentId: { $exists: false } },
                        { razorpayPaymentId: null },
                        { razorpayPaymentId: paymentId },
                    ],
                },
                { $set: { razorpayPaymentId: paymentId } }
            );
            if (!claimResult.matchedCount) {
                const completedPayment = await PaymentModel.findOne({
                    _id: payment._id,
                    status: "paid",
                    razorpayPaymentId: paymentId,
                });
                if (!completedPayment) {
                    throw createServiceError("A different payment is already associated with this order.", 409);
                }
            } else {
                const grantResult = await UserModel.updateOne(
                    { _id: userId, processedPaymentIds: { $ne: payment._id } },
                    {
                        $inc: { tripCredits: payment.credits },
                        $addToSet: { processedPaymentIds: payment._id },
                    }
                );
                if (!grantResult.matchedCount) {
                    const existingUser = await UserModel.findById(userId);
                    if (!existingUser) {
                        throw createServiceError("User account not found while granting trip credits.", 404);
                    }
                }

                await PaymentModel.updateOne(
                    { _id: payment._id, status: { $ne: "paid" } },
                    {
                        $set: {
                            status: "paid",
                            razorpayPaymentId: paymentId,
                            paidAt: new Date(),
                        },
                    },
                );
            }
        }

        const user = await UserModel.findById(userId).select("freeTripUsed tripCredits");
        if (!user) throw createServiceError("User account not found.", 404);
        return {
            success: true,
            message: "Test payment verified and trip credits added.",
            freeTripAvailable: user.freeTripUsed !== true,
            tripCredits: Number(user.tripCredits) || 0,
        };
    };

    const consumeTripCredit = async (userId) => {
        const freeTrip = await UserModel.findOneAndUpdate(
            { _id: userId, freeTripUsed: { $ne: true } },
            { $set: { freeTripUsed: true } },
            { new: true, runValidators: true }
        ).select("freeTripUsed tripCredits");
        if (freeTrip) {
            return {
                type: "free",
                freeTripAvailable: false,
                tripCredits: Number(freeTrip.tripCredits) || 0,
            };
        }

        const creditedTrip = await UserModel.findOneAndUpdate(
            { _id: userId, tripCredits: { $gt: 0 } },
            { $inc: { tripCredits: -1 } },
            { new: true, runValidators: true }
        ).select("freeTripUsed tripCredits");
        if (creditedTrip) {
            return {
                type: "credit",
                freeTripAvailable: creditedTrip.freeTripUsed !== true,
                tripCredits: Number(creditedTrip.tripCredits) || 0,
            };
        }

        throw createServiceError("Your free AI trip has been used. Buy a trip package to create another trip.", 402);
    };

    const refundTripCredit = async (userId, reservation) => {
        if (reservation?.type === "free") {
            await UserModel.updateOne({ _id: userId, freeTripUsed: true }, { $set: { freeTripUsed: false } });
        } else if (reservation?.type === "credit") {
            await UserModel.updateOne({ _id: userId }, { $inc: { tripCredits: 1 } });
        }
    };

    return {
        ensureDefaultPackages,
        listPackages,
        getAccount,
        getTripAvailability,
        createOrder,
        verifyPayment,
        consumeTripCredit,
        refundTripCredit,
    };
};

const paymentService = createPaymentService();

module.exports = {
    ...paymentService,
    createPaymentService,
    DEFAULT_PACKAGES,
    getRazorpayCredentials,
};
