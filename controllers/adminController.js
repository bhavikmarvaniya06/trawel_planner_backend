const User = require("../models/User");
const Trip = require("../models/Trip");
const ContactQuery = require("../models/ContactQuery");
const Feedback = require("../models/Feedback");
const Destination = require("../models/Destination");
const TripItinerary = require("../models/TripItinerary");
const TripExpense = require("../models/TripExpense");
const mongoose = require("mongoose");
const { getPaymentAdminData } = require("./paymentController");
const { validateDestinationPayload } = require("../services/destinationValidation");

const sendUpdateError = (res, error, message) => {
    console.error(`${message} error:`, error.message);

    if (error.name === "ValidationError" || error.name === "CastError") {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }

    if (error.code === 11000) {
        return res.status(409).json({
            success: false,
            message: "A record with a conflicting unique value already exists",
        });
    }

    return res.status(500).json({
        success: false,
        message,
    });
};

const getAdminDashboard = async (req, res) => {
    try {
        const [users, trips, queries, feedback, destinations, itineraries, expenses, paymentData] = await Promise.all([
            User.find().select("-password -processedPaymentIds").sort({ createdAt: -1 }),
            Trip.find().populate("user", "name email").sort({ createdAt: -1 }),
            ContactQuery.find().sort({ createdAt: -1 }),
            Feedback.find().populate("trip", "destination").sort({ createdAt: -1 }),
            Destination.find().select("-images.data").sort({ name: 1 }),
            TripItinerary.find().populate("trip", "destination startDate endDate currency").sort({ trip: 1, day: 1 }),
            TripExpense.find().populate("trip", "destination currency").sort({ date: -1 }),
            getPaymentAdminData(),
        ]);

        const averageRating = feedback.length
            ? feedback.reduce((sum, entry) => sum + entry.rating, 0) / feedback.length
            : 0;
        const budgetSummary = new Map();
        trips.forEach((trip) => {
            const currency = trip.currency || "USD";
            const summary = budgetSummary.get(currency) || { currency, budget: 0, expenses: 0 };
            summary.budget += Number(trip.budget) || 0;
            budgetSummary.set(currency, summary);
        });
        expenses.forEach((expense) => {
            const currency = expense.currency || expense.trip?.currency || "USD";
            const summary = budgetSummary.get(currency) || { currency, budget: 0, expenses: 0 };
            summary.expenses += Number(expense.amount) || 0;
            budgetSummary.set(currency, summary);
        });

        res.json({
            success: true,
            users,
            trips,
            queries,
            feedback,
            destinations,
            itineraries,
            expenses,
            packages: paymentData.packages,
            payments: paymentData.payments,
            stats: {
                totalUsers: users.length,
                tripCount: trips.length,
                averageRating,
                budgetSummary: Array.from(budgetSummary.values()),
                revenuePaise: paymentData.revenuePaise,
                paidPaymentCount: paymentData.paidPaymentCount,
                totalTripCredits: users.reduce((sum, user) => sum + (Number(user.tripCredits) || 0), 0),
            },
        });
    } catch (error) {
        console.error("Get admin dashboard error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to load admin dashboard",
        });
    }
};

const deleteUser = async (req, res) => {
    try {
        if (req.params.id === req.userId.toString()) {
            return res.status(400).json({
                success: false,
                message: "You cannot delete your own admin account",
            });
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        const trips = await Trip.find({ user: user._id }).select("_id").lean();
        const tripIds = trips.map((trip) => trip._id);
        await Promise.all([
            TripItinerary.deleteMany({ trip: { $in: tripIds } }),
            TripExpense.deleteMany({ trip: { $in: tripIds } }),
            Feedback.deleteMany({ trip: { $in: tripIds } }),
        ]);
        await Trip.deleteMany({ user: user._id });
        await user.deleteOne();

        res.json({
            success: true,
            message: "User and their trips deleted successfully",
        });
    } catch (error) {
        console.error("Delete user error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to delete user",
        });
    }
};

const deleteTrip = async (req, res) => {
    try {
        const trip = await Trip.findById(req.params.id);

        if (!trip) {
            return res.status(404).json({
                success: false,
                message: "Trip not found",
            });
        }

        await Promise.all([
            TripItinerary.deleteMany({ trip: trip._id }),
            TripExpense.deleteMany({ trip: trip._id }),
            Feedback.deleteMany({ trip: trip._id }),
        ]);
        await trip.deleteOne();

        res.json({
            success: true,
            message: "Trip deleted successfully",
        });
    } catch (error) {
        console.error("Delete trip error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to delete trip",
        });
    }
};

const updateUser = async (req, res) => {
    try {
        const { name, email, role } = req.body;
        if (
            (name !== undefined && (typeof name !== "string" || !name.trim())) ||
            (email !== undefined && (typeof email !== "string" || !email.trim())) ||
            (role !== undefined && !["user", "admin"].includes(role))
        ) {
            return res.status(400).json({
                success: false,
                message: "Provide a valid name, email, and role",
            });
        }

        if (name === undefined && email === undefined && role === undefined) {
            return res.status(400).json({
                success: false,
                message: "At least one user field is required",
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        if (user._id.toString() === req.userId.toString() && role && role !== user.role) {
            return res.status(400).json({
                success: false,
                message: "You cannot change your own admin role",
            });
        }

        if (name !== undefined) user.name = name.trim();
        if (email !== undefined) user.email = email.trim().toLowerCase();
        if (role !== undefined) user.role = role;

        await user.save();
        const safeUser = user.toObject();
        delete safeUser.password;

        res.json({
            success: true,
            user: safeUser,
        });
    } catch (error) {
        sendUpdateError(res, error, "Update user");
    }
};

const updateTrip = async (req, res) => {
    try {
        const { destination, startDate, endDate, travelers, budget, travelStyle, interests, status, currency } = req.body;
        const trip = await Trip.findById(req.params.id);

        if (!trip) {
            return res.status(404).json({
                success: false,
                message: "Trip not found",
            });
        }

        if (destination !== undefined) {
            if (typeof destination !== "string" || !destination.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Destination is required",
                });
            }
            trip.destination = destination.trim();
        }

        if (startDate !== undefined) trip.startDate = startDate;
        if (endDate !== undefined) trip.endDate = endDate;
        if (trip.startDate >= trip.endDate) {
            return res.status(400).json({
                success: false,
                message: "End date must be after start date",
            });
        }

        if (travelers !== undefined) {
            const travelerCount = Number(travelers);
            if (!Number.isInteger(travelerCount) || travelerCount < 1) {
                return res.status(400).json({
                    success: false,
                    message: "Travelers must be a whole number greater than zero",
                });
            }
            trip.travelers = travelerCount;
        }

        if (budget !== undefined) {
            const tripBudget = Number(budget);
            if (!Number.isFinite(tripBudget) || tripBudget < 0) {
                return res.status(400).json({
                    success: false,
                    message: "Budget must be a non-negative number",
                });
            }
            trip.budget = tripBudget;
        }

        if (status !== undefined) {
            if (!["planned", "booked", "completed", "cancelled"].includes(status)) {
                return res.status(400).json({ success: false, message: "Provide a valid trip status" });
            }
            trip.status = status;
        }
        if (currency !== undefined) {
            if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency.trim())) {
                return res.status(400).json({ success: false, message: "Currency must be a three-letter code" });
            }
            trip.currency = currency.trim().toUpperCase();
        }

        if (travelStyle !== undefined) trip.travelStyle = travelStyle;
        if (interests !== undefined) {
            if (!Array.isArray(interests)) {
                return res.status(400).json({
                    success: false,
                    message: "Interests must be a list",
                });
            }
            trip.interests = interests.map((interest) => String(interest).trim()).filter(Boolean);
        }

        await trip.save();
        await trip.populate("user", "name email");

        res.json({
            success: true,
            trip,
        });
    } catch (error) {
        sendUpdateError(res, error, "Update trip");
    }
};

const updateContactQuery = async (req, res) => {
    try {
        const { name, email, query, status } = req.body;
        if (
            (name !== undefined && (typeof name !== "string" || !name.trim())) ||
            (email !== undefined && (typeof email !== "string" || !email.trim())) ||
            (query !== undefined && (typeof query !== "string" || !query.trim())) ||
            (status !== undefined && !["open", "in_progress", "resolved"].includes(status))
        ) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and query must not be empty",
            });
        }

        if (name === undefined && email === undefined && query === undefined && status === undefined) {
            return res.status(400).json({
                success: false,
                message: "At least one contact query field is required",
            });
        }

        const contactQuery = await ContactQuery.findById(req.params.id);
        if (!contactQuery) {
            return res.status(404).json({
                success: false,
                message: "Contact query not found",
            });
        }

        if (name !== undefined) contactQuery.name = name.trim();
        if (email !== undefined) contactQuery.email = email.trim().toLowerCase();
        if (query !== undefined) contactQuery.query = query.trim();
        if (status !== undefined) contactQuery.status = status;

        await contactQuery.save();

        res.json({
            success: true,
            query: contactQuery,
        });
    } catch (error) {
        sendUpdateError(res, error, "Update contact query");
    }
};

const deleteContactQuery = async (req, res) => {
    try {
        const contactQuery = await ContactQuery.findByIdAndDelete(req.params.id);

        if (!contactQuery) {
            return res.status(404).json({
                success: false,
                message: "Contact query not found",
            });
        }

        res.json({
            success: true,
            message: "Contact query deleted successfully",
        });
    } catch (error) {
        sendUpdateError(res, error, "Unable to delete contact query");
    }
};

const createDestination = async (req, res) => {
    try {
        const { data, error } = validateDestinationPayload(req.body);
        if (error) return res.status(400).json({ success: false, message: error });
        const destination = await Destination.create(data);
        res.status(201).json({ success: true, destination });
    } catch (error) {
        sendUpdateError(res, error, "Create destination");
    }
};

const updateDestination = async (req, res) => {
    try {
        const destination = await Destination.findById(req.params.id);
        if (!destination) return res.status(404).json({ success: false, message: "Destination not found" });
        const { data, error } = validateDestinationPayload(req.body, true);
        if (error) return res.status(400).json({ success: false, message: error });
        if (!Object.keys(data).length) {
            return res.status(400).json({ success: false, message: "At least one destination field is required." });
        }
        Object.entries(data).forEach(([field, value]) => {
            if (field === "bookingDetails") {
                destination.bookingDetails = {
                    ...destination.bookingDetails?.toObject?.(),
                    ...destination.bookingDetails,
                    ...value,
                };
            } else {
                destination[field] = value;
            }
        });
        await destination.save();
        res.json({ success: true, destination });
    } catch (error) {
        sendUpdateError(res, error, "Update destination");
    }
};

const deleteDestination = async (req, res) => {
    try {
        const destination = await Destination.findByIdAndDelete(req.params.id);
        if (!destination) return res.status(404).json({ success: false, message: "Destination not found" });
        res.json({ success: true, message: "Destination deleted successfully" });
    } catch (error) {
        sendUpdateError(res, error, "Delete destination");
    }
};

const uploadDestinationImages = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Destination identifier is invalid." });
        }
        if (!Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({ success: false, message: "Select at least one JPG, PNG, or WebP image." });
        }
        const destination = await Destination.findById(req.params.id);
        if (!destination) {
            return res.status(404).json({ success: false, message: "Destination not found." });
        }
        if (destination.images.length + req.files.length > 10) {
            return res.status(400).json({ success: false, message: "A destination can have at most 10 uploaded images." });
        }

        const uploads = req.files.map((file) => {
            const bytes = file.buffer;
            const isPng = bytes.length >= 8 &&
                bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            const isJpeg = bytes.length >= 3 &&
                bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
            const isWebp = bytes.length >= 12 &&
                bytes.toString("ascii", 0, 4) === "RIFF" &&
                bytes.toString("ascii", 8, 12) === "WEBP";
            const contentType = isPng ? "image/png" : isJpeg ? "image/jpeg" : isWebp ? "image/webp" : "";

            if (!contentType || contentType !== file.mimetype) {
                throw Object.assign(new Error("Uploaded image content does not match a supported JPG, PNG, or WebP file."), {
                    statusCode: 400,
                });
            }

            return {
                filename: file.originalname.slice(0, 255),
                contentType,
                data: bytes,
            };
        });

        destination.images.push(...uploads);
        await destination.save();
        return res.status(201).json({
            success: true,
            images: destination.images.map((image) => ({
                _id: image._id,
                filename: image.filename,
                contentType: image.contentType,
                url: `/api/destinations/${destination._id}/images/${image._id}`,
            })),
        });
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        return sendUpdateError(res, error, "Upload destination images");
    }
};

const deleteDestinationImage = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id) ||
            !mongoose.Types.ObjectId.isValid(req.params.imageId)) {
            return res.status(400).json({ success: false, message: "Destination or image identifier is invalid." });
        }
        const destination = await Destination.findById(req.params.id);
        if (!destination) {
            return res.status(404).json({ success: false, message: "Destination not found." });
        }
        const image = destination.images.id(req.params.imageId);
        if (!image) {
            return res.status(404).json({ success: false, message: "Destination image not found." });
        }
        image.deleteOne();
        await destination.save();
        return res.json({ success: true, message: "Destination image removed." });
    } catch (error) {
        return sendUpdateError(res, error, "Delete destination image");
    }
};

const createFeedback = async (req, res) => {
    try {
        const { name, email, rating, message, page, trip } = req.body;
        if (typeof name !== "string" || !name.trim() || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5 || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({ success: false, message: "Provide a valid name, email, rating, and feedback message" });
        }
        if (trip && !(await Trip.exists({ _id: trip }))) {
            return res.status(400).json({ success: false, message: "Select an existing trip" });
        }
        const feedback = await Feedback.create({ name: name.trim(), email: email.trim().toLowerCase(), rating: Number(rating), message: message.trim(), page, trip: trip || null });
        await feedback.populate("trip", "destination");
        res.status(201).json({ success: true, feedback });
    } catch (error) {
        sendUpdateError(res, error, "Create feedback");
    }
};

const updateFeedback = async (req, res) => {
    try {
        const feedback = await Feedback.findById(req.params.id);
        if (!feedback) return res.status(404).json({ success: false, message: "Feedback not found" });
        const { name, email, rating, message, page, trip } = req.body;
        if (name !== undefined && (typeof name !== "string" || !name.trim() || name.trim().length > 80)) return res.status(400).json({ success: false, message: "Provide a valid name" });
        if (email !== undefined && (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 160)) return res.status(400).json({ success: false, message: "Provide a valid email" });
        if (rating !== undefined && (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5)) return res.status(400).json({ success: false, message: "Rating must be between 1 and 5" });
        if (message !== undefined && (typeof message !== "string" || !message.trim() || message.trim().length > 1200)) return res.status(400).json({ success: false, message: "Feedback message is required and must be under 1200 characters" });
        if (trip && !(await Trip.exists({ _id: trip }))) return res.status(400).json({ success: false, message: "Select an existing trip" });
        if (name !== undefined) feedback.name = name.trim();
        if (email !== undefined) feedback.email = email.trim().toLowerCase();
        if (rating !== undefined) feedback.rating = Number(rating);
        if (message !== undefined) feedback.message = message.trim();
        if (page !== undefined) feedback.page = String(page).slice(0, 180);
        if (trip !== undefined) feedback.trip = trip || null;
        await feedback.save();
        await feedback.populate("trip", "destination");
        res.json({ success: true, feedback });
    } catch (error) {
        sendUpdateError(res, error, "Update feedback");
    }
};

const deleteFeedback = async (req, res) => {
    try {
        const feedback = await Feedback.findByIdAndDelete(req.params.id);
        if (!feedback) return res.status(404).json({ success: false, message: "Feedback not found" });
        res.json({ success: true, message: "Feedback deleted successfully" });
    } catch (error) {
        sendUpdateError(res, error, "Delete feedback");
    }
};

const createTripItinerary = async (req, res) => {
    try {
        const trip = await Trip.findById(req.body.trip);
        if (!trip) return res.status(400).json({ success: false, message: "Select an existing trip" });
        const itinerary = await TripItinerary.create(req.body);
        await itinerary.populate("trip", "destination startDate endDate currency");
        res.status(201).json({ success: true, itinerary });
    } catch (error) {
        sendUpdateError(res, error, "Create itinerary item");
    }
};

const updateTripItinerary = async (req, res) => {
    try {
        const itinerary = await TripItinerary.findById(req.params.id);
        if (!itinerary) return res.status(404).json({ success: false, message: "Itinerary item not found" });
        const fields = ["trip", "day", "date", "title", "activities", "estimatedCost"];
        const supplied = fields.filter((field) => req.body[field] !== undefined);
        if (!supplied.length) return res.status(400).json({ success: false, message: "At least one itinerary field is required" });
        if (req.body.trip && !(await Trip.exists({ _id: req.body.trip }))) return res.status(400).json({ success: false, message: "Select an existing trip" });
        supplied.forEach((field) => { itinerary[field] = req.body[field]; });
        await itinerary.save();
        await itinerary.populate("trip", "destination startDate endDate currency");
        res.json({ success: true, itinerary });
    } catch (error) {
        sendUpdateError(res, error, "Update itinerary item");
    }
};

const deleteTripItinerary = async (req, res) => {
    try {
        const itinerary = await TripItinerary.findByIdAndDelete(req.params.id);
        if (!itinerary) return res.status(404).json({ success: false, message: "Itinerary item not found" });
        res.json({ success: true, message: "Itinerary item deleted successfully" });
    } catch (error) {
        sendUpdateError(res, error, "Delete itinerary item");
    }
};

const createTripExpense = async (req, res) => {
    try {
        if (!(await Trip.exists({ _id: req.body.trip }))) return res.status(400).json({ success: false, message: "Select an existing trip" });
        const expense = await TripExpense.create(req.body);
        await expense.populate("trip", "destination currency");
        res.status(201).json({ success: true, expense });
    } catch (error) {
        sendUpdateError(res, error, "Create trip expense");
    }
};

const updateTripExpense = async (req, res) => {
    try {
        const expense = await TripExpense.findById(req.params.id);
        if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
        const fields = ["trip", "category", "description", "amount", "currency", "date"];
        const supplied = fields.filter((field) => req.body[field] !== undefined);
        if (!supplied.length) return res.status(400).json({ success: false, message: "At least one expense field is required" });
        if (req.body.trip && !(await Trip.exists({ _id: req.body.trip }))) return res.status(400).json({ success: false, message: "Select an existing trip" });
        supplied.forEach((field) => { expense[field] = req.body[field]; });
        await expense.save();
        await expense.populate("trip", "destination currency");
        res.json({ success: true, expense });
    } catch (error) {
        sendUpdateError(res, error, "Update trip expense");
    }
};

const deleteTripExpense = async (req, res) => {
    try {
        const expense = await TripExpense.findByIdAndDelete(req.params.id);
        if (!expense) return res.status(404).json({ success: false, message: "Expense not found" });
        res.json({ success: true, message: "Expense deleted successfully" });
    } catch (error) {
        sendUpdateError(res, error, "Delete trip expense");
    }
};

module.exports = {
    getAdminDashboard,
    deleteUser,
    deleteTrip,
    updateUser,
    updateTrip,
    updateContactQuery,
    deleteContactQuery,
    createDestination,
    updateDestination,
    deleteDestination,
    uploadDestinationImages,
    deleteDestinationImage,
    createFeedback,
    updateFeedback,
    deleteFeedback,
    createTripItinerary,
    updateTripItinerary,
    deleteTripItinerary,
    createTripExpense,
    updateTripExpense,
    deleteTripExpense,
};
