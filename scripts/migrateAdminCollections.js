const mongoose = require("mongoose");

const ContactQuery = require("../models/ContactQuery");
const Destination = require("../models/Destination");
const Trip = require("../models/Trip");
const TripItinerary = require("../models/TripItinerary");

const migrateLegacyQueries = async () => {
    const database = mongoose.connection.db;
    const legacyExists = await database.listCollections({ name: "contactqueries" }).hasNext();
    if (!legacyExists) return;

    const legacyCollection = database.collection("contactqueries");
    const operations = [];
    for await (const query of legacyCollection.find()) {
        operations.push({
            updateOne: {
                filter: { _id: query._id },
                update: { $setOnInsert: { ...query, status: query.status || "open" } },
                upsert: true,
            },
        });
        if (operations.length === 500) {
            await database.collection("customer_queries").bulkWrite(operations, { ordered: false });
            operations.length = 0;
        }
    }
    if (operations.length) await database.collection("customer_queries").bulkWrite(operations, { ordered: false });
};

const migrateEmbeddedItineraries = async () => {
    const trips = await Trip.find({ itinerary: { $type: "array", $ne: [] } })
        .select("itinerary startDate")
        .lean();

    for (const trip of trips) {
        const operations = (trip.itinerary || []).flatMap((item, index) => {
            if (!item || typeof item !== "object") return [];
            const day = Number(item.day) || index + 1;
            const legacyKey = `${trip._id}:${index}`;
            return [{
                updateOne: {
                    filter: { legacyKey },
                    update: {
                        $setOnInsert: {
                            trip: trip._id,
                            day,
                            date: item.date || new Date(new Date(trip.startDate).getTime() + (day - 1) * 86400000),
                            title: String(item.title || `Day ${day}`).slice(0, 180),
                            activities: Array.isArray(item.activities) ? item.activities : [],
                            estimatedCost: Math.max(0, Number(item.estimatedCost) || 0),
                            legacyKey,
                        },
                    },
                    upsert: true,
                },
            }];
        });
        if (operations.length) await TripItinerary.bulkWrite(operations, { ordered: false });
    }
};

const seedDestinationsFromTrips = async () => {
    const destinations = await Trip.distinct("destination");
    for (const name of destinations.filter((value) => typeof value === "string" && value.trim())) {
        await Destination.updateOne(
            { name: name.trim() },
            { $setOnInsert: { name: name.trim(), country: "", description: "", currency: "USD" } },
            { upsert: true }
        );
    }
};

const migrateAdminCollections = async () => {
    await migrateLegacyQueries();
    await migrateEmbeddedItineraries();
    await seedDestinationsFromTrips();
};

module.exports = migrateAdminCollections;
