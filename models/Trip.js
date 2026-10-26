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

        destinationPackage: {
            destinationId: { type: mongoose.Schema.Types.ObjectId, ref: "Destination" },
            name: { type: String, trim: true, maxlength: 120 },
            pricePerPerson: { type: Number, min: 0 },
            currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/ },
            bookingUrl: { type: String, trim: true, maxlength: 2048, default: "" },
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
        collaborators: {
            type: [{
                user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                role: { type: String, enum: ["editor"], default: "editor" },
                status: { type: String, enum: ["invited", "accepted"], default: "invited" },
                invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
                invitedAt: { type: Date, default: Date.now },
                acceptedAt: { type: Date, default: null },
            }],
            default: [],
        },
        destinationVotes: {
            type: [{
                destination: { type: String, required: true, trim: true, maxlength: 120 },
                voters: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
            }],
            default: [],
        },
    },
    {
        timestamps: true,
        collection: "trips",
    }
);

module.exports = mongoose.model("Trip", tripSchema);