const Trip = require("../models/Trip");
const TripItinerary = require("../models/TripItinerary");
const {
    generateItinerary,
    generateTripSuggestions,
} = require("../services/itineraryService");

const getTripSuggestions = async (req, res) => {
    try {
        const destination = String(req.body.destination || "").trim().slice(0, 100);
        const days = Number(req.body.days);

        if (!Number.isInteger(days) || days < 1 || days > 30) {
            return res.status(400).json({
                success: false,
                message: "Trip duration must be between 1 and 30 days.",
            });
        }

        const interests = Array.isArray(req.body.interests)
            ? req.body.interests.filter((interest) => typeof interest === "string").slice(0, 10)
            : [];
        const suggestions = await generateTripSuggestions({
            destination,
            days,
            interests,
            travelStyle: String(req.body.travelStyle || "balanced").slice(0, 30),
            budget: Number(req.body.budget) || undefined,
        });

        return res.status(200).json({ success: true, ...suggestions });
    } catch (error) {
        console.error("Trip suggestions error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to get travel suggestions.",
        });
    }
};


// ============================
// CREATE TRIP
// ============================

const createTrip = async (req, res) => {
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
            itinerary: submittedItinerary,
        } = req.body;


        // Validation
        const normalizedDestination = typeof destination === "string" ? destination.trim() : "";
        const parsedStart = new Date(startDate);
        const parsedEnd = new Date(endDate);
        const travelerCount = Number(travelers);
        const tripBudget = Number(budget);
        if (
            !normalizedDestination ||
            normalizedDestination.length > 120 ||
            !Number.isFinite(parsedStart.getTime()) ||
            !Number.isFinite(parsedEnd.getTime()) ||
            parsedStart >= parsedEnd ||
            !Number.isInteger(travelerCount) ||
            travelerCount < 1 ||
            !Number.isFinite(tripBudget) ||
            tripBudget < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required trip details",
            });
        }


        const itinerary = Array.isArray(submittedItinerary) && submittedItinerary.length
            ? submittedItinerary
            : await generateItinerary({
                destination,
                startDate,
                endDate,
                travelers,
                budget,
                travelStyle,
                interests,
                places: Array.isArray(places)
                    ? places.filter((place) => typeof place === "string").slice(0, 12)
                    : [],
            });

        if (!Array.isArray(itinerary) || itinerary.length > 30 || itinerary.some((item) => !item || typeof item !== "object" || Array.isArray(item))) {
            return res.status(400).json({ success: false, message: "Provide a valid itinerary with no more than 30 days" });
        }

        for (const [index, item] of itinerary.entries()) {
            const day = Number(item.day ?? index + 1);
            const estimatedCost = Number(item.estimatedCost ?? 0);
            if (!Number.isInteger(day) || day < 1 || day > 30 || !Number.isFinite(estimatedCost) || estimatedCost < 0 ||
                (item.title !== undefined && (typeof item.title !== "string" || item.title.length > 180)) ||
                (item.activities !== undefined && !Array.isArray(item.activities))) {
                return res.status(400).json({ success: false, message: "Itinerary days, titles, activities, or estimated costs are invalid" });
            }
        }

        const trip = await Trip.create({
            user: req.userId,
            destination: normalizedDestination,
            startDate: parsedStart,
            endDate: parsedEnd,
            travelers: travelerCount,
            budget: tripBudget,
            travelStyle,
            interests,
            itinerary,
        });

        try {
            await TripItinerary.insertMany(itinerary.map((item, index) => ({
                trip: trip._id,
                day: Number(item.day) || index + 1,
                date: item.date || new Date(parsedStart.getTime() + index * 86400000),
                title: String(item.title || `Day ${index + 1}`).slice(0, 180),
                activities: Array.isArray(item.activities) ? item.activities : [],
                estimatedCost: Math.max(0, Number(item.estimatedCost) || 0),
            })));
        } catch (error) {
            await TripItinerary.deleteMany({ trip: trip._id });
            await Trip.findByIdAndDelete(trip._id);
            throw error;
        }


        res.status(201).json({
            success: true,
            message: "Trip created successfully",
            trip,
        });

    } catch (error) {

        console.error("Create trip error:", error.message);

        res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Server error",
        });
    }
};


// ============================
// GET MY TRIPS
// ============================

const getMyTrips = async (req, res) => {
    try {

        const trips = await Trip.find({
            user: req.userId,
        }).sort({
            createdAt: -1,
        });


        res.status(200).json({
            success: true,
            count: trips.length,
            trips,
        });

    } catch (error) {

        console.error("Get trips error:", error.message);

        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

const getTripById = async (req, res) => {
    try {
        const trip = await Trip.findOne({
            _id: req.params.id,
            user: req.userId,
        });

        if (!trip) {
            return res.status(404).json({
                success: false,
                message: "Trip not found",
            });
        }

        res.status(200).json({
            success: true,
            trip,
        });

    } catch (error) {
        console.error("Get trip error:", error.message);

        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

module.exports = {
    getTripSuggestions,
    createTrip,
    getMyTrips,
    getTripById,
};