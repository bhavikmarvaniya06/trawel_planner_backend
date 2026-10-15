const { generateItinerary } = require("../services/itineraryService");

const planTrip = async (req, res) => {
    try {
        const {
            destination,
            startDate,
            endDate,
            travelers,
            budget,
            travelStyle,
            interests,
            places,
        } = req.body;
        const parsedStart = new Date(startDate);
        const parsedEnd = new Date(endDate);
        const tripDays = Math.floor((parsedEnd - parsedStart) / 86400000) + 1;

        if (
            typeof destination !== "string" ||
            !destination.trim() ||
            Number.isNaN(parsedStart.getTime()) ||
            Number.isNaN(parsedEnd.getTime()) ||
            !Number.isInteger(travelers) ||
            travelers < 1 ||
            travelers > 20 ||
            !Number.isFinite(Number(budget)) ||
            Number(budget) <= 0 ||
            tripDays < 1 ||
            tripDays > 30
        ) {
            return res.status(400).json({
                success: false,
                message: "Provide a destination, valid dates, 1-20 travelers, a positive budget, and a trip of 1-30 days.",
            });
        }

        const validStyles = ["balanced", "adventure", "relaxing", "family", "luxury", "budget", "romantic"];
        const itinerary = await generateItinerary({
            destination: destination.trim().slice(0, 100),
            startDate: parsedStart,
            endDate: parsedEnd,
            travelers,
            budget: Number(budget),
            travelStyle: validStyles.includes(travelStyle) ? travelStyle : "balanced",
            interests: Array.isArray(interests)
                ? interests.filter((interest) => typeof interest === "string").slice(0, 10)
                : [],
            places: Array.isArray(places)
                ? places.filter((place) => typeof place === "string").slice(0, 12)
                : [],
        });

        const generatedBy = process.env.GEMINI_API_KEY?.trim() ? "gemini" : "wikivoyage";
        return res.status(200).json({ success: true, generatedBy, itinerary });
    } catch (error) {
        console.error("AI trip planning error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to generate the itinerary.",
        });
    }
};

module.exports = { planTrip };