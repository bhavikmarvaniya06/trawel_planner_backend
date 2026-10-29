const express = require("express");
const mongoose = require("mongoose");

const {
    getTripSuggestions,
    getOptimizedRoute,
    createTrip,
    getMyTrips,
    getTripById,
    getTripWeather,
} = require("../controllers/tripController");
const {
    getTripInvitations,
    inviteCollaborator,
    acceptInvitation,
    updateTripItinerary,
    voteForDestination,
    getTripExpenses,
    addTripExpense,
} = require("../controllers/collaborationController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.param("id", (req, res, next, id) => {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
            success: false,
            message: "Trip identifier is invalid.",
        });
    }
    return next();
});

// Create trip
router.post("/suggestions", protect, getTripSuggestions);
router.post("/optimize-route", protect, getOptimizedRoute);
router.post("/", protect, createTrip);


// Get my trips
router.get("/", protect, getMyTrips);
router.get("/invitations", protect, getTripInvitations);
router.post("/:id/invitations", protect, inviteCollaborator);
router.patch("/:id/invitations/accept", protect, acceptInvitation);
router.put("/:id/itinerary", protect, updateTripItinerary);
router.post("/:id/votes", protect, voteForDestination);
router.get("/:id/expenses", protect, getTripExpenses);
router.post("/:id/expenses", protect, addTripExpense);


// Get single trip
router.get("/:id/weather", protect, getTripWeather);
router.get("/:id", protect, getTripById);


module.exports = router;