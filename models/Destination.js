const mongoose = require("mongoose");

const destinationImageSchema = new mongoose.Schema(
    {
        filename: { type: String, trim: true, maxlength: 255, default: "" },
        contentType: { type: String, enum: ["image/jpeg", "image/png", "image/webp"], required: true },
        data: { type: Buffer, required: true, select: false },
    },
    { timestamps: true }
);

const itineraryDaySchema = new mongoose.Schema(
    {
        day: { type: Number, required: true, min: 1, max: 30 },
        title: { type: String, required: true, trim: true, maxlength: 180 },
        description: { type: String, trim: true, maxlength: 1200, default: "" },
        activities: { type: [String], default: [] },
    },
    { _id: false }
);

const destinationSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, unique: true, maxlength: 120 },
        country: { type: String, trim: true, maxlength: 100, default: "" },
        region: { type: String, trim: true, maxlength: 100, default: "" },
        location: { type: String, trim: true, maxlength: 200, default: "" },
        description: { type: String, trim: true, maxlength: 2000, default: "" },
        imageUrl: { type: String, trim: true, maxlength: 2048, default: "" },
        currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: "USD" },
        price: { type: Number, min: 0, default: 0 },
        durationDays: { type: Number, min: 1, max: 30, default: 1 },
        itinerary: { type: [itineraryDaySchema], default: [] },
        bookingDetails: {
            available: { type: Boolean, default: true },
            bookingUrl: { type: String, trim: true, maxlength: 2048, default: "" },
            contactEmail: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
            contactPhone: { type: String, trim: true, maxlength: 40, default: "" },
            notes: { type: String, trim: true, maxlength: 1000, default: "" },
        },
        images: { type: [destinationImageSchema], default: [] },
        active: { type: Boolean, default: true },
    },
    { timestamps: true, collection: "destinations" }
);

destinationSchema.pre("validate", function () {
    if (this.itinerary.some((day) => day.day > this.durationDays)) {
        this.invalidate("itinerary", "Itinerary days cannot exceed the package duration.");
    }
});

module.exports = mongoose.model("Destination", destinationSchema);
