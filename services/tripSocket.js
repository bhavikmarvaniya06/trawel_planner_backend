const jwt = require("jsonwebtoken");
const Trip = require("../models/Trip");

const configureTripSockets = (io) => {
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string" || !token) {
            next(new Error("Authentication required."));
            return;
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.data.userId = decoded.userId;
            next();
        } catch {
            next(new Error("Invalid or expired token."));
        }
    });

    io.on("connection", (socket) => {
        socket.on("trip:join", async (tripId, acknowledge = () => {}) => {
            const respond = typeof acknowledge === "function" ? acknowledge : () => {};
            if (typeof tripId !== "string" || !/^[a-f\d]{24}$/i.test(tripId)) {
                respond({ success: false, message: "Invalid trip identifier." });
                return;
            }
            try {
                const trip = await Trip.exists({
                    _id: tripId,
                    $or: [
                        { user: socket.data.userId },
                        { collaborators: { $elemMatch: { user: socket.data.userId, status: "accepted" } } },
                    ],
                });
                if (!trip) {
                    respond({ success: false, message: "You do not have access to this trip." });
                    return;
                }
                await socket.join(`trip:${tripId}`);
                respond({ success: true });
            } catch (error) {
                console.error("Trip socket authorization failed:", error.message);
                respond({ success: false, message: "Unable to join trip updates." });
            }
        });
    });
};

module.exports = configureTripSockets;
