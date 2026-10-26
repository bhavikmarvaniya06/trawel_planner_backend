const Trip = require("../models/Trip");

const findAccessibleTrip = (tripId, userId) => Trip.findOne({
    _id: tripId,
    $or: [
        { user: userId },
        { collaborators: { $elemMatch: { user: userId, status: "accepted" } } },
    ],
});

const isTripOwner = (trip, userId) => String(trip.user) === String(userId);

const emitTripUpdate = (req, event, payload) => {
    req.app.get("io")?.to(`trip:${String(payload.tripId)}`).emit(event, payload);
};

module.exports = { findAccessibleTrip, isTripOwner, emitTripUpdate };
