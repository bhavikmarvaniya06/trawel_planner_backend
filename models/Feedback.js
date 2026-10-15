const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 160,
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
        },
        message: {
            type: String,
            required: true,
            trim: true,
            maxlength: 1200,
        },
        page: {
            type: String,
            trim: true,
            maxlength: 180,
            default: "",
        },
        trip: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Trip",
            default: null,
            index: true,
        },
    },
    {
        timestamps: true,
        collection: "feedback",
    }
);

module.exports = mongoose.model("Feedback", feedbackSchema);