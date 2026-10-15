const express = require("express");
const protect = require("../middleware/authMiddleware");
const { planTrip } = require("../controllers/aiController");
const { getTripSuggestions } = require("../controllers/tripController");

const router = express.Router();

router.post("/plan", protect, planTrip);
router.post("/suggestions", protect, getTripSuggestions);

module.exports = router;