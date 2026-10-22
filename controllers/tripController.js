const Trip = require("../models/Trip");
const TripItinerary = require("../models/TripItinerary");
const User = require("../models/User");
const { sendTripConfirmationEmail } = require("../services/tripEmailService");
const {
    generateItinerary,
    generateTripSuggestions,
} = require("../services/itineraryService");

const getTripEmailErrorMessage = (error) => {
    if (error.code === "EAUTH") {
        return "Trip saved, but the email provider rejected the sender credentials.";
    }
    if (["ECONNECTION", "ESOCKET", "ETIMEDOUT", "EDNS", "EAI_AGAIN"].includes(error.code)) {
        return "Trip saved, but the email service could not be reached. Check backend network and DNS.";
    }
    if (error.responseCode === 550 || error.code === "EENVELOPE") {
        return "Trip saved, but the email provider rejected the account email address.";
    }
    return "Trip saved, but the PDF email could not be sent. Check the backend email configuration.";
};

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

        let emailSent = false;
        let emailMessage = "Trip saved, but its PDF could not be sent to your email.";

        try {
            const user = await User.findById(req.userId).select("name email");
            if (user?.email) {
                await sendTripConfirmationEmail(user, trip);
                emailSent = true;
                emailMessage = "Trip PDF sent to your login email.";
            } else {
                emailMessage = "Trip saved, but no email is linked to this account.";
            }
        } catch (emailError) {
            console.error("Trip confirmation email failed:", JSON.stringify({
                code: emailError.code,
                responseCode: emailError.responseCode,
                command: emailError.command,
            }));
            emailMessage = getTripEmailErrorMessage(emailError);
        }

        res.status(201).json({
            success: true,
            message: "Trip created successfully",
            emailSent,
            emailMessage,
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

const emailTripPdf = async (req, res) => {
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

        const user = await User.findById(req.userId).select("name email");
        if (!user?.email) {
            return res.status(400).json({
                success: false,
                message: "No email is linked to this account.",
            });
        }

        await sendTripConfirmationEmail(user, trip);
        return res.status(200).json({
            success: true,
            message: `Trip PDF sent to ${user.email}.`,
        });
    } catch (error) {
        console.error("Trip PDF resend failed:", JSON.stringify({
            code: error.code,
            responseCode: error.responseCode,
            command: error.command,
        }));
        return res.status(503).json({
            success: false,
            message: getTripEmailErrorMessage(error),
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
    emailTripPdf,
    getMyTrips,
    getTripById,
};