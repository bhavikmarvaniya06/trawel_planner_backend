const mongoose = require("mongoose");

const contactQuerySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },

        query: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ["open", "in_progress", "resolved"],
            default: "open",
        },
    },
    {
        timestamps: true,
        collection: "customer_queries",
    }
);

module.exports = mongoose.model("ContactQuery", contactQuerySchema);
