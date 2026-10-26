const express = require("express");
const protect = require("../middleware/authMiddleware");
const {
    getRecommendations,
    toggleSavedPlace,
} = require("../controllers/recommendationController");

const router = express.Router();

router.use(protect);
router.get("/", getRecommendations);
router.post("/saved-places", toggleSavedPlace);

module.exports = router;
