const express = require("express");
const protect = require("../middleware/authMiddleware");
const {
    getMyNotifications,
    markNotificationRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.use(protect);
router.get("/", getMyNotifications);
router.patch("/:id/read", markNotificationRead);

module.exports = router;
