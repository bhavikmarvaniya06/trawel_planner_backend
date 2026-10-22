const mongoose = require("mongoose");

const ContactQuery = require("../models/ContactQuery");
const Destination = require("../models/Destination");
const Trip = require("../models/Trip");
const TripItinerary = require("../models/TripItinerary");
const defaultDestinations = require("../data/defaultDestinations.json");

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

const seedDefaultDestinationCatalog = async () => {
    const database = mongoose.connection.db;
    const migrationId = "default-destination-catalog-v1";
    if (await database.collection("migrations").findOne({ _id: migrationId })) return;

    const existingDestinations = await Destination.find().lean();
    const destinationsByName = new Map(
        existingDestinations.map((destination) => [destination.name.trim().toLowerCase(), destination])
    );

    for (const entry of defaultDestinations) {
        const nameKey = entry.name.trim().toLowerCase();
        const existing = destinationsByName.get(nameKey);
        const defaults = {
            aliases: entry.aliases || [],
            country: entry.country || "",
            description: entry.description || "",
            imageUrl: entry.image || "",
            imageCredit: entry.imageCredit || { label: "", url: "" },
        };

        if (!existing) {
            const destination = await Destination.create({
                name: entry.name.trim(),
                ...defaults,
            });
            destinationsByName.set(nameKey, destination.toObject());
            continue;
        }

        const updates = {};
        Object.entries(defaults).forEach(([field, value]) => {
            const currentValue = existing[field];
            if (field === "imageCredit") {
                if (!currentValue?.label && value.label) updates["imageCredit.label"] = value.label;
                if (!currentValue?.url && value.url) updates["imageCredit.url"] = value.url;
            } else if ((!currentValue || (Array.isArray(currentValue) && currentValue.length === 0)) &&
                (Array.isArray(value) ? value.length > 0 : Boolean(value))) {
                updates[field] = value;
            }
        });

        if (Object.keys(updates).length) {
            await Destination.updateOne({ _id: existing._id }, { $set: updates });
        }
    }

    await database.collection("migrations").insertOne({
        _id: migrationId,
        completedAt: new Date(),
    });
};

const migrateAdminCollections = async () => {
    await migrateLegacyQueries();
    await migrateEmbeddedItineraries();
    await seedDestinationsFromTrips();
    await seedDefaultDestinationCatalog();
};

module.exports = migrateAdminCollections;
