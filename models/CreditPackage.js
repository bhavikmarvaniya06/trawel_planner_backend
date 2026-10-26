const mongoose = require("mongoose");

const creditPackageSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, immutable: true },
        name: { type: String, required: true, trim: true, maxlength: 80 },
        credits: { type: Number, required: true, min: 1, max: 100 },
        amountPaise: { type: Number, required: true, min: 100 },
        currency: { type: String, enum: ["INR"], default: "INR", immutable: true },
        active: { type: Boolean, default: true },
        sortOrder: { type: Number, required: true },
    },
    { timestamps: true, collection: "credit_packages" }
);

module.exports = mongoose.model("CreditPackage", creditPackageSchema);
