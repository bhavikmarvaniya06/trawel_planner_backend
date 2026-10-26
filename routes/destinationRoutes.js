const express = require("express");
const {
    getPublicDestinations,
    getPublicDestination,
    getPublicDestinationImage,
} = require("../controllers/destinationController");

const router = express.Router();

router.get("/", getPublicDestinations);
router.get("/:id/images/:imageId", getPublicDestinationImage);
router.get("/:id", getPublicDestination);

module.exports = router;
