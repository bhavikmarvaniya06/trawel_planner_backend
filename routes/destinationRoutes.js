const express = require("express");
const { getPublicDestinations } = require("../controllers/destinationController");

const router = express.Router();

router.get("/", getPublicDestinations);

module.exports = router;
