const mongoose = require("mongoose");

const tripExpenseSchema = new mongoose.Schema(
    {
        trip: { type: mongoose.Schema.Types.ObjectId, ref: "Trip", required: true, index: true },
        category: { type: String, required: true, trim: true, maxlength: 80 },
        description: { type: String, trim: true, maxlength: 500, default: "" },
        amount: { type: Number, required: true, min: 0 },
        currency: { type: String, uppercase: true, trim: true, match: /^[A-Z]{3}$/, default: "USD" },
        date: { type: Date, required: true, default: Date.now },
        paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        shares: [{
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
            amount: { type: Number, required: true, min: 0 },
        }],
    },
    { timestamps: true, collection: "trip_expenses" }
);

module.exports = mongoose.model("TripExpense", tripExpenseSchema);
