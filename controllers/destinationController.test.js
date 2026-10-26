const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Destination = require("../models/Destination");
const {
    getPublicDestinations,
    getPublicDestination,
    getPublicDestinationImage,
} = require("./destinationController");

const originalFind = Destination.find;
const originalFindOne = Destination.findOne;
const validId = "507f1f77bcf86cd799439011";
const imageId = "507f1f77bcf86cd799439012";

const makeResponse = () => ({
    statusCode: 200,
    body: null,
    headers: {},
    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
    set(headers) {
        this.headers = { ...this.headers, ...headers };
        return this;
    },
    send(body) {
        this.body = body;
        return this;
    },
});

afterEach(() => {
    Destination.find = originalFind;
    Destination.findOne = originalFindOne;
});

test("public catalog lists published package details without binary image data", async () => {
    let queryFilter;
    Destination.find = (filter) => {
        queryFilter = filter;
        return {
            select: () => ({
                sort: () => ({
                    lean: async () => [{
                        _id: validId,
                        name: "Coastal Week",
                        country: "India",
                        price: 18000,
                        currency: "INR",
                        durationDays: 4,
                        images: [{ _id: imageId, filename: "coast.webp", contentType: "image/webp" }],
                    }],
                }),
            }),
        };
    };
    const response = makeResponse();

    await getPublicDestinations({}, response);

    assert.deepEqual(queryFilter, { active: true });
    assert.equal(response.body.destinations[0].images[0].url, `/api/destinations/${validId}/images/${imageId}`);
    assert.equal("data" in response.body.destinations[0].images[0], false);
});

test("public destination details do not disclose unpublished destinations", async () => {
    let queryFilter;
    Destination.findOne = (filter) => {
        queryFilter = filter;
        return { select: () => ({ lean: async () => null }) };
    };
    const response = makeResponse();

    await getPublicDestination({ params: { id: validId } }, response);

    assert.deepEqual(queryFilter, { _id: validId, active: true });
    assert.equal(response.statusCode, 404);
});

test("image endpoint returns published image bytes with a safe content type", async () => {
    const data = Buffer.from("webp-image-bytes");
    Destination.findOne = (filter) => ({
        select: async () => ({
            images: { id: (id) => id === imageId ? {
                contentType: "image/webp",
                data,
            } : null },
            _id: filter._id,
        }),
    });
    const response = makeResponse();

    await getPublicDestinationImage({ params: { id: validId, imageId } }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "image/webp");
    assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
    assert.deepEqual(response.body, data);
});
