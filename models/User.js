const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },

        password: {
            type: String,
            minlength: 6,
        },

        googleId: {
            type: String,
            unique: true,
            sparse: true,
        },

        profileImage: {
            type: String,
            default: "",
        },
        savedPlaces: {
            type: [String],
            default: [],
        },
        interests: {
            type: [String],
            default: [],
        },
        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user",
        },
        freeTripUsed: {
            type: Boolean,
            default: false,
        },
        tripCredits: {
            type: Number,
            min: 0,
            default: 0,
        },
        processedPaymentIds: {
            type: [mongoose.Schema.Types.ObjectId],
            default: [],
            select: false,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model("User", userSchema);