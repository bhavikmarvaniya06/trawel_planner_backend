const Trip = require("../models/Trip");
const Destination = require("../models/Destination");
const mongoose = require("mongoose");
const TripItinerary = require("../models/TripItinerary");
const {
    generateItinerary,
    generateTripSuggestions,
} = require("../services/itineraryService");
const {
    consumeTripCredit,
    getTripAvailability,
    refundTripCredit,
} = require("../services/paymentService");
const { optimizeRoute } = require("../services/routeOptimizer");
const { findAccessibleTrip } = require("../services/tripAccess");
const { getTripWeatherForecast } = require("../services/weatherMonitor");

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

const getOptimizedRoute = async (req, res) => {
    try {
        const route = await optimizeRoute(req.body || {});
        return res.status(200).json({ success: true, ...route });
    } catch (error) {
        console.error("Route optimization error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to optimize the route.",
        });
    }
};


// ============================
// CREATE TRIP
// ============================

const createTrip = async (req, res) => {
    let creditReservation = null;
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
            destinationPackageId,
        } = req.body;


        // Validation
        let normalizedDestination = typeof destination === "string" ? destination.trim() : "";
        const parsedStart = new Date(startDate);
        const parsedEnd = new Date(endDate);
        const travelerCount = Number(travelers);
        let tripBudget = Number(budget);
        let packageDestination = null;

        if (destinationPackageId !== undefined) {
            if (typeof destinationPackageId !== "string" ||
                !mongoose.Types.ObjectId.isValid(destinationPackageId)) {
                return res.status(400).json({
                    success: false,
                    message: "The selected destination package is invalid.",
                });
            }
            packageDestination = await Destination.findOne({
                _id: destinationPackageId,
                active: true,
            });
            if (!packageDestination) {
                return res.status(404).json({
                    success: false,
                    message: "This destination package is no longer available.",
                });
            }
            if (packageDestination.bookingDetails?.available === false) {
                return res.status(409).json({
                    success: false,
                    message: "This destination package is currently unavailable to book.",
                });
            }
            normalizedDestination = packageDestination.name;
            const expectedTotal = Number(packageDestination.price) * travelerCount;
            if (!Number.isFinite(expectedTotal) || expectedTotal < 0) {
                return res.status(400).json({
                    success: false,
                    message: "This destination package has an invalid price.",
                });
            }
            tripBudget = expectedTotal;
            const requestedDays = Math.floor((parsedEnd.getTime() - parsedStart.getTime()) / 86400000) + 1;
            if (requestedDays !== packageDestination.durationDays) {
                return res.status(400).json({
                    success: false,
                    message: `This destination package requires a ${packageDestination.durationDays}-day trip.`,
                });
            }
        }

        if (
            !normalizedDestination ||
            normalizedDestination.length > 120 ||
            !Number.isFinite(parsedStart.getTime()) ||
            !Number.isFinite(parsedEnd.getTime()) ||
            parsedStart > parsedEnd ||
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

        const availability = await getTripAvailability(req.userId);
        if (!availability.freeTripAvailable && availability.tripCredits < 1) {
            return res.status(402).json({
                success: false,
                message: "Your free AI trip has been used. Buy a trip package from your dashboard to create another trip.",
                ...availability,
            });
        }

        const packageItinerary = packageDestination?.itinerary?.length
            ? packageDestination.itinerary.map((day) => ({
                day: day.day,
                title: day.title,
                activities: [
                    ...(day.description ? [day.description] : []),
                    ...(day.activities || []),
                ],
                estimatedCost: 0,
            }))
            : null;
        const itinerary = packageItinerary ||
            (Array.isArray(submittedItinerary) && submittedItinerary.length
                ? submittedItinerary
                : await generateItinerary({
                destination: normalizedDestination,
                startDate,
                endDate,
                travelers,
                budget,
                travelStyle,
                interests,
                places: Array.isArray(places)
                    ? places.filter((place) => typeof place === "string").slice(0, 12)
                    : [],
                }));

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

        creditReservation = await consumeTripCredit(req.userId);
        const trip = await Trip.create({
            user: req.userId,
            destination: normalizedDestination,
            startDate: parsedStart,
            endDate: parsedEnd,
            travelers: travelerCount,
            budget: tripBudget,
            ...(packageDestination ? {
                currency: packageDestination.currency,
                destinationPackage: {
                    destinationId: packageDestination._id,
                    name: packageDestination.name,
                    pricePerPerson: packageDestination.price,
                    currency: packageDestination.currency,
                    bookingUrl: packageDestination.bookingDetails?.bookingUrl || "",
                },
            } : {}),
            travelStyle,
            interests,
            itinerary,
        });
        const creditResult = creditReservation;

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
        creditReservation = null;

        res.status(201).json({
            success: true,
            message: "Trip created successfully",
            freeTripAvailable: creditResult.freeTripAvailable,
            tripCredits: creditResult.tripCredits,
            trip,
        });

    } catch (error) {

        console.error("Create trip error:", error.message);
        if (creditReservation) {
            try {
                await refundTripCredit(req.userId, creditReservation);
            } catch (refundError) {
                console.error("Trip credit refund failed:", refundError.message);
            }

        }
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
            $or: [
                { user: req.userId },
                { collaborators: { $elemMatch: { user: req.userId, status: "accepted" } } },
            ],
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
        const trip = await findAccessibleTrip(req.params.id, req.userId)
            .populate("user", "name email")
            .populate("collaborators.user", "name email");

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

const getTripWeather = async (req, res) => {
    try {
        const trip = await findAccessibleTrip(req.params.id, req.userId);
        if (!trip) {
            return res.status(404).json({
                success: false,
                message: "Trip not found",
            });
        }

        const weather = await getTripWeatherForecast(trip);
        return res.status(200).json({ success: true, ...weather });
    } catch (error) {
        console.error(`Get trip weather error for trip ${req.params.id}:`, error.message);
        return res.status(503).json({
            success: false,
            message: "Weather data is temporarily unavailable. Please try again.",
        });
    }
};

module.exports = {
    getTripSuggestions,
    getOptimizedRoute,
    createTrip,
    getMyTrips,
    getTripById,
    getTripWeather,
};