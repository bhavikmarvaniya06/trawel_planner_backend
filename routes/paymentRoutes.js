const express = require("express");
const protect = require("../middleware/authMiddleware");
const {
    getPaymentAccount,
    getCreditPackages,
    createPaymentOrder,
    verifyPaymentCallback,
} = require("../controllers/paymentController");

const router = express.Router();

router.use(protect);
router.get("/account", getPaymentAccount);
router.get("/packages", getCreditPackages);
router.post("/orders", createPaymentOrder);
router.post("/verify", verifyPaymentCallback);

module.exports = router;
