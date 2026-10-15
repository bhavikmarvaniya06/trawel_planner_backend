const Feedback = require("../models/Feedback");

const createFeedback = async (req, res) => {
    try {
        const { name, email, rating, message, page } = req.body;
        const numericRating = Number(rating);

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof message !== "string" ||
            !name.trim() ||
            !email.trim() ||
            !message.trim() ||
            name.trim().length > 80 ||
            email.trim().length > 160 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            message.trim().length > 1200 ||
            !Number.isInteger(numericRating) ||
            numericRating < 1 ||
            numericRating > 5
        ) {
            return res.status(400).json({
                success: false,
                message: "Provide a valid name and email, a 1-5 rating, and feedback under 1200 characters.",
            });
        }

        const feedback = await Feedback.create({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            rating: numericRating,
            message: message.trim(),
            page: typeof page === "string" ? page.trim().slice(0, 180) : "",
        });

        res.status(201).json({
            success: true,
            message: "Thank you for sharing your feedback.",
            feedback,
        });
    } catch (error) {
        console.error("Create feedback error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to submit feedback right now.",
        });
    }
};

module.exports = { createFeedback };