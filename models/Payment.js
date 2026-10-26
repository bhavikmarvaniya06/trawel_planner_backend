const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        creditPackage: { type: mongoose.Schema.Types.ObjectId, ref: "CreditPackage", required: true },
        packageKey: { type: String, required: true },
        packageName: { type: String, required: true },
        credits: { type: Number, required: true, min: 1 },
        amountPaise: { type: Number, required: true, min: 100 },
        currency: { type: String, enum: ["INR"], required: true },
        razorpayOrderId: { type: String, required: true, unique: true },
        razorpayPaymentId: { type: String, unique: true, sparse: true },
        status: { type: String, enum: ["pending", "paid", "failed"], default: "pending", index: true },
        paidAt: { type: Date, default: null },
    },
    { timestamps: true, collection: "payments" }
);

module.exports = mongoose.model("Payment", paymentSchema);
