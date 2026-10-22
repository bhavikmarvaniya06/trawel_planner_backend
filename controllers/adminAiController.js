const { generateDestinationDescription } = require("../services/itineraryService");

const draftDestinationDescription = async (req, res) => {
    const { name, country, region } = req.body;
    if (
        typeof name !== "string" ||
        !name.trim() ||
        name.trim().length > 120 ||
        (country !== undefined && (typeof country !== "string" || country.length > 100)) ||
        (region !== undefined && (typeof region !== "string" || region.length > 100))
    ) {
        return res.status(400).json({
            success: false,
            message: "Provide a valid destination name, country, and region.",
        });
    }

    try {
        const description = await generateDestinationDescription({
            name: name.trim(),
            country: typeof country === "string" ? country.trim() : "",
            region: typeof region === "string" ? region.trim() : "",
        });
        return res.json({ success: true, description });
    } catch (error) {
        console.error("Admin destination description generation error:", error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode ? error.message : "Unable to draft a destination description.",
        });
    }
};

module.exports = { draftDestinationDescription };
