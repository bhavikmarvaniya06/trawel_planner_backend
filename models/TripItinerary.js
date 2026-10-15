const mongoose = require("mongoose");

const tripItinerarySchema = new mongoose.Schema(
    {
        trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },
        day: { type: Number, required: true, min: 1 },
        date: { type: Date, required: true },
        title: { type: String, required: true, trim: true, maxlength: 180 },
        activities: { type: [mongoose.Schema.Types.Mixed], default: [] },
        estimatedCost: { type: Number, min: 0, default: 0 },
        legacyKey: { type: String, unique: true, sparse: true },
    },
    { timestamps: true, collection: "trip_itinerary" }
);

module.exports = mongoose.model("TripItinerary", tripItinerarySchema);
