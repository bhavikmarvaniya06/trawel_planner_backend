const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        trip: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Trip",
            required: true,
        },
        destination: {
            type: String,
            required: true,
            trim: true,
        },
        tripDate: {
            type: String,
            required: true,
        },
        dedupeKey: {
            type: String,
            required: true,
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        conditions: {
            type: [String],
            default: [],
        },
        weather: {
            temperatureMax: Number,
            temperatureMin: Number,
            precipitationProbability: Number,
            precipitation: Number,
            windSpeed: Number,
            weatherCode: Number,
        },
        suggestions: {
            type: [String],
            default: [],
        },
        affectedActivities: {
            type: [String],
            default: [],
        },
        read: {
            type: Boolean,
            default: false,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

notificationSchema.index({ user: 1, dedupeKey: 1 }, { unique: true });
notificationSchema.index({ user: 1, resolvedAt: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
