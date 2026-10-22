const express = require("express");

const {
    getTripSuggestions,
    createTrip,
    emailTripPdf,
    getMyTrips,
    getTripById,
} = require("../controllers/tripController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();


// Create trip
router.post("/suggestions", protect, getTripSuggestions);
router.post("/", protect, createTrip);
router.post("/:id/email", protect, emailTripPdf);


// Get my trips
router.get("/", protect, getMyTrips);


// Get single trip
router.get("/:id", protect, getTripById);


module.exports = router;