const express = require("express");
const { createContactQuery } = require("../controllers/contactController");

const router = express.Router();

router.post("/", createContactQuery);

module.exports = router;
