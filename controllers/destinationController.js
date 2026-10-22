const Destination = require("../models/Destination");

const getPublicDestinations = async (req, res) => {
    try {
        const destinations = await Destination.find({ active: true })
            .select("name aliases country region description imageUrl imageCredit currency")
            .sort({ name: 1 })
            .lean();

        res.json({ success: true, destinations });
    } catch (error) {
        console.error("Get public destinations error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to load featured destinations",
        });
    }
};

module.exports = { getPublicDestinations };
