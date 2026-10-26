const Destination = require("../models/Destination");
const mongoose = require("mongoose");

const publicDestinationData = (destination) => ({
    ...destination,
    country: destination.country || "",
    region: destination.region || "",
    location: destination.location || "",
    description: destination.description || "",
    imageUrl: destination.imageUrl || "",
    currency: destination.currency || "USD",
    price: Number(destination.price) || 0,
    durationDays: Number(destination.durationDays) || 1,
    itinerary: destination.itinerary || [],
    bookingDetails: destination.bookingDetails || {
        available: true,
        bookingUrl: "",
        contactEmail: "",
        contactPhone: "",
        notes: "",
    },
    images: (destination.images || []).map((image) => ({
        _id: image._id,
        filename: image.filename,
        contentType: image.contentType,
        url: `/api/destinations/${destination._id}/images/${image._id}`,
    })),
});

const getPublicDestinations = async (req, res) => {
    try {
        const destinations = await Destination.find({ active: true })
            .select("-images.data")
            .sort({ name: 1 })
            .lean();

        res.json({
            success: true,
            destinations: destinations.map(publicDestinationData),
        });
    } catch (error) {
        console.error("Get public destinations error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to load featured destinations",
        });
    }
};

const getPublicDestination = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ success: false, message: "Destination identifier is invalid." });
        }
        const destination = await Destination.findOne({
            _id: req.params.id,
            active: true,
        }).select("-images.data").lean();
        if (!destination) {
            return res.status(404).json({ success: false, message: "Published destination not found." });
        }
        return res.json({ success: true, destination: publicDestinationData(destination) });
    } catch (error) {
        console.error("Get public destination error:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load this destination." });
    }
};

const getPublicDestinationImage = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id) ||
            !mongoose.Types.ObjectId.isValid(req.params.imageId)) {
            return res.status(400).json({ success: false, message: "Destination or image identifier is invalid." });
        }
        const destination = await Destination.findOne({
            _id: req.params.id,
            active: true,
            "images._id": req.params.imageId,
        }).select("+images.data");
        const image = destination?.images.id(req.params.imageId);
        if (!image) {
            return res.status(404).json({ success: false, message: "Published destination image not found." });
        }
        res.set({
            "Content-Type": image.contentType,
            "Content-Length": image.data.length,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        });
        return res.send(image.data);
    } catch (error) {
        console.error("Get public destination image error:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load this destination image." });
    }
};

module.exports = {
    getPublicDestinations,
    getPublicDestination,
    getPublicDestinationImage,
};
