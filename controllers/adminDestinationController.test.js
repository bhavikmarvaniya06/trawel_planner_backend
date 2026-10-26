const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Destination = require("../models/Destination");
const {
    createDestination,
    updateDestination,
    uploadDestinationImages,
} = require("./adminController");

const originalCreate = Destination.create;
const originalFindById = Destination.findById;

const makeResponse = () => ({
    statusCode: 200,
    body: null,
    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

afterEach(() => {
    Destination.create = originalCreate;
    Destination.findById = originalFindById;
});

test("admin destination creation validates fields before writing to MongoDB", async () => {
    let createdData;
    Destination.create = async (data) => {
        createdData = data;
        return { ...data, _id: "destination-1" };
    };
    const response = makeResponse();

    await createDestination({
        body: {
            name: "  Lake District ",
            price: "1800",
            currency: "inr",
            durationDays: "2",
            itinerary: [{ day: 3, title: "Invalid day" }],
        },
    }, response);

    assert.equal(response.statusCode, 400);
    assert.equal(createdData, undefined);
});

test("admin partial edits preserve other booking fields", async () => {
    const destination = new Destination({
        name: "Lake District",
        bookingDetails: {
            available: true,
            notes: "Call before booking",
            contactEmail: "stay@example.com",
        },
    });
    destination.save = async () => {};
    Destination.findById = async () => destination;
    const response = makeResponse();

    await updateDestination({
        params: { id: "destination-1" },
        body: { bookingDetails: { available: false } },
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.destination.bookingDetails.available, false);
    assert.equal(response.body.destination.bookingDetails.notes, "Call before booking");
    assert.equal(response.body.destination.bookingDetails.contactEmail, "stay@example.com");
});

test("image upload checks file signatures before storing and serves saved image metadata", async () => {
    const destination = new Destination({ name: "Lake District" });
    destination.save = async () => {};
    Destination.findById = async () => destination;
    const response = makeResponse();
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    await uploadDestinationImages({
        params: { id: destination._id.toString() },
        files: [{ buffer: pngBytes, mimetype: "image/png", originalname: "lake.png" }],
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(destination.images.length, 1);
    assert.equal(response.body.images[0].contentType, "image/png");
    assert.match(
        response.body.images[0].url,
        new RegExp(`^/api/destinations/${destination._id}/images/[a-f\\d]{24}$`)
    );
});

test("admin destination endpoints retain protect and admin-only middleware", () => {
    const router = require("../routes/adminRoutes");
    const protect = require("../middleware/authMiddleware");
    const adminOnly = require("../middleware/adminMiddleware");

    for (const [method, path] of [
        ["post", "/destinations"],
        ["put", "/destinations/:id"],
        ["delete", "/destinations/:id"],
        ["post", "/destinations/:id/images"],
        ["delete", "/destinations/:id/images/:imageId"],
    ]) {
        const layer = router.stack.find((entry) => (
            entry.route?.path === path && entry.route.methods[method]
        ));
        assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
        assert.equal(layer.route.stack[0].handle, protect);
        assert.equal(layer.route.stack[1].handle, adminOnly);
    }
});
