const Trip = require("../models/Trip");
const User = require("../models/User");
const { runRecommendationEngine } = require("../services/recommendationService");

const getRecommendations = async (req, res) => {
    try {
        const [user, trips] = await Promise.all([
            User.findById(req.userId).select("interests savedPlaces").lean(),
            Trip.find({
                user: req.userId,
                status: { $in: ["planned", "booked", "completed"] },
            }).sort({ startDate: -1 }).select("destination interests budget status").limit(50).lean(),
        ]);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }

        const requestedBudget = req.query.budget === undefined ? undefined : Number(req.query.budget);
        const requestedDays = req.query.days === undefined ? 3 : Number(req.query.days);
        if ((requestedBudget !== undefined && (!Number.isFinite(requestedBudget) || requestedBudget < 0 || requestedBudget > 100000000))
            || !Number.isInteger(requestedDays) || requestedDays < 1 || requestedDays > 30) {
            return res.status(400).json({
                success: false,
                message: "Budget must be a valid non-negative amount and trip duration must be between 1 and 30 days.",
            });
        }

        const interests = [
            ...(user.interests || []),
            ...trips.flatMap((trip) => trip.interests || []),
        ];
        const budget = requestedBudget ?? trips.find((trip) => Number(trip.budget) > 0)?.budget;
        const results = await runRecommendationEngine({
            interests: [...new Set(interests)].slice(0, 30),
            savedPlaces: (user.savedPlaces || []).slice(0, 100),
            travelHistory: trips.map(({ destination, interests: tripInterests }) => ({
                destination,
                interests: tripInterests || [],
            })),
            budget,
            days: requestedDays,
        });
        return res.status(200).json({ success: true, ...results });
    } catch (error) {
        console.error("Recommendation request failed:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to create travel recommendations.",
        });
    }
};

const toggleSavedPlace = async (req, res) => {
    const destination = typeof req.body.destination === "string" ? req.body.destination.trim() : "";
    if (!destination || destination.length > 120) {
        return res.status(400).json({
            success: false,
            message: "Provide a destination name up to 120 characters.",
        });
    }

    try {
        const user = await User.findById(req.userId).select("savedPlaces");
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found." });
        }
        const existing = user.savedPlaces.findIndex(
            (place) => place.toLowerCase() === destination.toLowerCase()
        );
        if (existing >= 0) user.savedPlaces.splice(existing, 1);
        else {
            if (user.savedPlaces.length >= 100) {
                return res.status(400).json({
                    success: false,
                    message: "You can save up to 100 destinations.",
                });
            }
            user.savedPlaces.push(destination);
        }
        await user.save();

        return res.status(200).json({
            success: true,
            saved: existing < 0,
            savedPlaces: user.savedPlaces,
        });
    } catch (error) {
        console.error("Saved destination update failed:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update saved destinations.",
        });
    }
};

module.exports = { getRecommendations, toggleSavedPlace };
