const express = require("express");

const protect = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");
const {
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
    createFeedback,
    updateFeedback,
    deleteFeedback,
    createTripItinerary,
    updateTripItinerary,
    deleteTripItinerary,
    createTripExpense,
    updateTripExpense,
    deleteTripExpense,
} = require("../controllers/adminController");

const router = express.Router();


router.get(
    "/dashboard",
    protect,
    adminOnly,
    getAdminDashboard
);

router.delete("/users/:id", protect, adminOnly, deleteUser);
router.put("/users/:id", protect, adminOnly, updateUser);

router.delete("/trips/:id", protect, adminOnly, deleteTrip);
router.put("/trips/:id", protect, adminOnly, updateTrip);

router.put("/queries/:id", protect, adminOnly, updateContactQuery);
router.delete("/queries/:id", protect, adminOnly, deleteContactQuery);

router.post("/destinations", protect, adminOnly, createDestination);
router.put("/destinations/:id", protect, adminOnly, updateDestination);
router.delete("/destinations/:id", protect, adminOnly, deleteDestination);

router.post("/feedback", protect, adminOnly, createFeedback);
router.put("/feedback/:id", protect, adminOnly, updateFeedback);
router.delete("/feedback/:id", protect, adminOnly, deleteFeedback);

router.post("/itineraries", protect, adminOnly, createTripItinerary);
router.put("/itineraries/:id", protect, adminOnly, updateTripItinerary);
router.delete("/itineraries/:id", protect, adminOnly, deleteTripItinerary);

router.post("/expenses", protect, adminOnly, createTripExpense);
router.put("/expenses/:id", protect, adminOnly, updateTripExpense);
router.delete("/expenses/:id", protect, adminOnly, deleteTripExpense);


module.exports = router;