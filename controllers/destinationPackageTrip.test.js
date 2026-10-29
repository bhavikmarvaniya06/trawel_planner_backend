const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const Destination = require("../models/Destination");
const Trip = require("../models/Trip");
const TripItinerary = require("../models/TripItinerary");
const paymentService = require("../services/paymentService");
const itineraryService = require("../services/itineraryService");

const originals = {
    destinationFindOne: Destination.findOne,
    tripCreate: Trip.create,
    itineraryInsertMany: TripItinerary.insertMany,
    getTripAvailability: paymentService.getTripAvailability,
    consumeTripCredit: paymentService.consumeTripCredit,
    generateItinerary: itineraryService.generateItinerary,
};

const createTripController = () => {
    delete require.cache[require.resolve("./tripController")];
    return require("./tripController");
};

const makeResponse = () => ({
    statusCode: null,
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
    Destination.findOne = originals.destinationFindOne;
    Trip.create = originals.tripCreate;
    TripItinerary.insertMany = originals.itineraryInsertMany;
    paymentService.getTripAvailability = originals.getTripAvailability;
    paymentService.consumeTripCredit = originals.consumeTripCredit;
    itineraryService.generateItinerary = originals.generateItinerary;
    delete require.cache[require.resolve("./tripController")];
});

test("package selection saves a priced trip using existing credit rules and curated itinerary", async () => {
    const destinationId = "507f1f77bcf86cd799439011";
    const tripId = "507f1f77bcf86cd799439013";
    const persistedTrip = { _id: tripId, destination: "Lake District" };
    let createdTrip;
    let savedItinerary;
    let creditConsumed = false;

    Destination.findOne = async (filter) => {
        assert.deepEqual(filter, { _id: destinationId, active: true });
        return {
            _id: destinationId,
            name: "Lake District",
            price: 2400,
            currency: "INR",
            durationDays: 2,
            bookingDetails: { available: true, bookingUrl: "https://provider.example/book" },
            itinerary: [
                { day: 1, title: "Arrival", description: "Check in", activities: ["Visit the lake"] },
                { day: 2, title: "Departure", activities: ["Local market"] },
            ],
        };
    };
    paymentService.getTripAvailability = async () => ({ freeTripAvailable: true, tripCredits: 0 });
    paymentService.consumeTripCredit = async () => {
        creditConsumed = true;
        return { freeTripAvailable: false, tripCredits: 0 };
    };
    itineraryService.generateItinerary = async () => {
        throw new Error("Published package itinerary should be used.");
    };
    Trip.create = async (trip) => {
        createdTrip = trip;
        return persistedTrip;
    };
    TripItinerary.insertMany = async (entries) => {
        savedItinerary = entries;
    };

    const { createTrip } = createTripController();
    const response = makeResponse();
    await createTrip({
        userId: "user-1",
        body: {
            destinationPackageId: destinationId,
            destination: "client supplied wrong destination",
            startDate: "2027-04-01",
            endDate: "2027-04-02",
            travelers: 3,
            budget: 1,
            travelStyle: "balanced",
            interests: [],
        },
    }, response);

    assert.equal(response.statusCode, 201);
    assert.equal(createdTrip.destination, "Lake District");
    assert.equal(createdTrip.budget, 7200);
    assert.equal(createdTrip.currency, "INR");
    assert.equal(createdTrip.destinationPackage.pricePerPerson, 2400);
    assert.equal(createdTrip.destinationPackage.bookingUrl, "https://provider.example/book");
    assert.equal(savedItinerary.length, 2);
    assert.equal(savedItinerary[0].title, "Arrival");
    assert.equal(creditConsumed, true);
    assert.equal(response.body.trip._id, tripId);
    assert.equal("emailMessage" in response.body, false);
});

test("package booking rejects unpublished or unavailable destinations", async () => {
    Destination.findOne = async () => null;
    paymentService.getTripAvailability = async () => {
        throw new Error("Unavailable packages should not reserve credits.");
    };

    const { createTrip } = createTripController();
    const response = makeResponse();
    await createTrip({
        userId: "user-1",
        body: {
            destinationPackageId: "507f1f77bcf86cd799439011",
            startDate: "2027-04-01",
            endDate: "2027-04-01",
            travelers: 1,
            budget: 0,
        },
    }, response);

    assert.equal(response.statusCode, 404);
    assert.match(response.body.message, /no longer available/i);
});
