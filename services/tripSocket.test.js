const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const Trip = require("../models/Trip");
const configureTripSockets = require("./tripSocket");

const createIoFixture = () => {
    let middleware;
    let connectionHandler;
    const io = {
        use(handler) {
            middleware = handler;
        },
        on(event, handler) {
            if (event === "connection") connectionHandler = handler;
        },
    };
    configureTripSockets(io);
    return {
        middleware,
        connect(socket) {
            return new Promise((resolve, reject) => {
                middleware(socket, (error) => {
                    if (error) reject(error);
                    else {
                        connectionHandler(socket);
                        resolve();
                    }
                });
            });
        },
    };
};

test("Socket.IO requires a valid JWT and only permits trip members to join rooms", async () => {
    process.env.JWT_SECRET = "socket-test-secret";
    const originalExists = Trip.exists;
    Trip.exists = async (filter) => (
        filter._id === "507f1f77bcf86cd799439011"
        && filter.$or.some((condition) => condition.collaborators?.$elemMatch?.user === "member-1")
            ? { _id: filter._id }
            : null
    );

    try {
        const fixture = createIoFixture();
        await assert.rejects(
            fixture.connect({ handshake: { auth: {} } }),
            /Authentication required/
        );

        const token = jwt.sign({ userId: "member-1" }, process.env.JWT_SECRET);
        const joinedRooms = [];
        const handlers = {};
        const socket = {
            handshake: { auth: { token } },
            data: {},
            on(event, handler) {
                handlers[event] = handler;
            },
            join: async (room) => joinedRooms.push(room),
        };
        await fixture.connect(socket);

        const acknowledged = await new Promise((resolve) => {
            handlers["trip:join"]("507f1f77bcf86cd799439011", resolve);
        });
        assert.deepEqual(acknowledged, { success: true });
        assert.deepEqual(joinedRooms, ["trip:507f1f77bcf86cd799439011"]);

        const denied = await new Promise((resolve) => {
            handlers["trip:join"]("507f1f77bcf86cd799439012", resolve);
        });
        assert.equal(denied.success, false);

        const malformed = await new Promise((resolve) => {
            handlers["trip:join"]("not-an-object-id", resolve);
        });
        assert.equal(malformed.success, false);
    } finally {
        Trip.exists = originalExists;
    }
});
