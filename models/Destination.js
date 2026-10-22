const mongoose = require("mongoose");

const destinationSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, unique: true, maxlength: 120 },
        country: { type: String, trim: true, maxlength: 100, default: "" },
        region: { type: String, trim: true, maxlength: 100, default: "" },
        description: { type: String, trim: true, maxlength: 2000, default: "" },
        imageUrl: { type: String, trim: true, maxlength: 2048, default: "" },
        currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: "USD" },
        active: { type: Boolean, default: true },
    },
    { timestamps: true, collection: "destinations" }
);

module.exports = mongoose.model("Destination", destinationSchema);
