const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Trip = require("../models/Trip");
const TripExpense = require("../models/TripExpense");
const TripItinerary = require("../models/TripItinerary");
const User = require("../models/User");
const {
    addTripExpense,
    inviteCollaborator,
    updateTripItinerary,
} = require("./collaborationController");

test("keeps existing admin-created expenses valid without group split details", () => {
    const expense = new TripExpense({
        trip: new mongoose.Types.ObjectId(),
        category: "Transport",
        amount: 25,
    });
    assert.equal(expense.validateSync(), undefined);
});

const createResponse = () => ({
    statusCode: 200,
    body: null,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

const createRequest = (body = {}, userId = "owner-1") => {
    const events = [];
    return {
        params: { id: "trip-1" },
        body,
        userId,
        events,
        app: {
            get: () => ({
                to: () => ({
                    emit: (event, payload) => events.push({ event, payload }),
                }),
            }),
        },
    };
};

test("requires trip owners to invite existing users by a valid email", async () => {
    const originalFindById = Trip.findById;
    const originalFindUser = User.findOne;
    const trip = {
        _id: "trip-1",
        user: "owner-1",
        collaborators: [],
        save: async () => {},
    };
    Trip.findById = async () => trip;
    User.findOne = () => ({ select: async () => ({ _id: "traveler-2", name: "Alex", email: "alex@example.com" }) });

    try {
        const invalidRequest = createRequest({ email: "not-an-email" });
        const invalidResponse = createResponse();
        await inviteCollaborator(invalidRequest, invalidResponse);
        assert.equal(invalidResponse.statusCode, 400);

        const deniedResponse = createResponse();
        await inviteCollaborator(createRequest({ email: "alex@example.com" }, "not-owner"), deniedResponse);
        assert.equal(deniedResponse.statusCode, 403);

        const request = createRequest({ email: "alex@example.com" });
        const response = createResponse();
        await inviteCollaborator(request, response);
        assert.equal(response.statusCode, 201);
        assert.equal(trip.collaborators[0].status, "invited");
        assert.equal(String(trip.collaborators[0].user), "traveler-2");
        assert.equal(request.events[0].event, "trip:collaboration-updated");
    } finally {
        Trip.findById = originalFindById;
        User.findOne = originalFindUser;
    }
});

test("validates itinerary edits and syncs accepted group changes", async () => {
    const originalFindOne = Trip.findOne;
    const originalDeleteMany = TripItinerary.deleteMany;
    const originalInsertMany = TripItinerary.insertMany;
    const trip = {
        _id: "trip-1",
        user: "owner-1",
        startDate: new Date("2030-03-01T00:00:00.000Z"),
        endDate: new Date("2030-03-03T00:00:00.000Z"),
        collaborators: [],
        itinerary: [],
        save: async () => {},
    };
    let inserted;
    Trip.findOne = () => Promise.resolve(trip);
    TripItinerary.deleteMany = async () => {};
    TripItinerary.insertMany = async (documents) => { inserted = documents; };

    try {
        const invalidResponse = createResponse();
        await updateTripItinerary(createRequest({ itinerary: [{ title: "Bad day" }] }), invalidResponse);
        assert.equal(invalidResponse.statusCode, 400);

        const request = createRequest({
            itinerary: [{
                day: 1,
                date: "2030-03-01",
                title: "Shared day",
                estimatedCost: 50,
                activities: [{ title: "Museum", type: "sightseeing" }],
            }],
        });
        const response = createResponse();
        await updateTripItinerary(request, response);
        assert.equal(response.statusCode, 200);
        assert.equal(trip.itinerary[0].title, "Shared day");
        assert.equal(inserted[0].trip, "trip-1");
        assert.equal(request.events[0].event, "trip:itinerary-updated");
    } finally {
        Trip.findOne = originalFindOne;
        TripItinerary.deleteMany = originalDeleteMany;
        TripItinerary.insertMany = originalInsertMany;
    }
});

test("creates group expenses with accurate shares only for accepted members", async () => {
    const originalFindOne = Trip.findOne;
    const originalCreate = TripExpense.create;
    const originalFindById = TripExpense.findById;
    const trip = {
        _id: "trip-1",
        user: "owner-1",
        currency: "INR",
        collaborators: [
            { user: "member-2", status: "accepted" },
            { user: "pending-3", status: "invited" },
        ],
    };
    let expenseRecord;
    Trip.findOne = () => Promise.resolve(trip);
    TripExpense.create = async (record) => {
        expenseRecord = record;
        return { _id: "expense-1" };
    };
    TripExpense.findById = () => ({
        populate() { return this; },
        lean: async () => ({ ...expenseRecord, _id: "expense-1" }),
    });

    try {
        const request = createRequest({ category: "Meals", amount: 100.01 }, "member-2");
        const response = createResponse();
        await addTripExpense(request, response);
        assert.equal(response.statusCode, 201);
        assert.deepEqual(expenseRecord.shares.map((share) => share.amount), [50, 50.01]);
        assert.equal(expenseRecord.shares.some((share) => share.user === "pending-3"), false);
        assert.equal(expenseRecord.paidBy, "member-2");
        assert.equal(request.events[0].event, "trip:expense-added");
    } finally {
        Trip.findOne = originalFindOne;
        TripExpense.create = originalCreate;
        TripExpense.findById = originalFindById;
    }
});
