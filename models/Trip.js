const mongoose = require("mongoose");

const tripSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },

        destination: {
            type: String,
            required: true,
            trim: true,
        },

        startDate: {
            type: Date,
            required: true,
        },

        endDate: {
            type: Date,
            required: true,
        },

        travelers: {
            type: Number,
            required: true,
            min: 1,
        },

        budget: {
            type: Number,
            required: true,
            min: 0,
        },

        status: {
            type: String,
            enum: ["planned", "booked", "completed", "cancelled"],
            default: "planned",
        },

        currency: {
            type: String,
            uppercase: true,
            trim: true,
            match: /^[A-Z]{3}$/,
            default: "USD",
        },

        travelStyle: {
            type: String,
            enum: [
                "balanced",
                "adventure",
                "relaxing",
                "family",
                "luxury",
                "budget",
                "romantic",
            ],
            default: "balanced",
        },

        interests: {
            type: [String],
            default: [],
        },

        itinerary: {
            type: Array,
            default: [],
        },
    },
    {
        timestamps: true,
        collection: "trips",
    }
);

module.exports = mongoose.model("Trip", tripSchema);