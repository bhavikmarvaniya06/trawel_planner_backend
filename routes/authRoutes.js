const express = require("express");

const {
    registerUser,
    loginUser,
    getMe,
    requestOtpLogin,
    verifyOtpLogin,
} = require("../controllers/authController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();


// Public routes
router.post("/register", registerUser);

router.post("/login", loginUser);
router.post("/request-otp", requestOtpLogin);
router.post("/verify-otp", verifyOtpLogin);


// Protected route
router.get("/me", protect, getMe);


module.exports = router;