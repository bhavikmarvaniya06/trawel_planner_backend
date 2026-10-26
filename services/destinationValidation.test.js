const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateDestinationPayload } = require("./destinationValidation");

test("validates and normalizes destination packages and itinerary fields", () => {
    const result = validateDestinationPayload({
        name: "  Alpine Escape ",
        country: " Switzerland ",
        location: "Interlaken",
        currency: "chf",
        price: "1200.5",
        durationDays: "2",
        active: true,
        itinerary: [
            { day: 2, title: "Lake day", activities: [" Boat cruise "] },
            { day: 1, title: "Arrival", description: " Check in " },
        ],
        bookingDetails: {
            available: true,
            contactEmail: " Bookings@Example.com ",
        },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.data.name, "Alpine Escape");
    assert.equal(result.data.currency, "CHF");
    assert.equal(result.data.price, 1200.5);
    assert.equal(result.data.durationDays, 2);
    assert.deepEqual(result.data.itinerary.map((day) => day.day), [1, 2]);
    assert.deepEqual(result.data.itinerary[1].activities, ["Boat cruise"]);
    assert.equal(result.data.bookingDetails.contactEmail, "bookings@example.com");
});

test("rejects invalid prices, duration, image URLs, and itinerary structures", () => {
    for (const payload of [
        { name: "X", price: -1 },
        { name: "X", durationDays: 31 },
        { name: "X", imageUrl: "javascript:alert(1)" },
        { name: "X", itinerary: [{ day: 1, title: "" }] },
        { name: "X", bookingDetails: { bookingUrl: "file:///private" } },
        { name: "X", active: "false" },
    ]) {
        assert.ok(validateDestinationPayload(payload).error, JSON.stringify(payload));
    }
});

test("partial updates only allow the declared destination fields", () => {
    assert.deepEqual(
        validateDestinationPayload({
            bookingDetails: { available: false, notes: "Temporarily closed" },
            role: "admin",
        }, true).data,
        { bookingDetails: { available: false, notes: "Temporarily closed" } }
    );
});
