const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
    checkTripWeather,
    getActivitySuggestions,
    getWeatherConditions,
    getTripWeatherForecast,
} = require("./weatherMonitor");

test("flags rain, severe wind, heat, freezing weather, and thunderstorms", () => {
    assert.deepEqual(getWeatherConditions({
        weather_code: 61,
        temperature_2m_max: 36,
        temperature_2m_min: -1,
        precipitation_sum: 12,
        precipitation_probability_max: 80,
        wind_speed_10m_max: 55,
    }), ["rain", "strong wind", "extreme heat", "freezing temperatures"]);
    assert.deepEqual(getWeatherConditions({
        weather_code: 95,
        temperature_2m_max: 24,
        temperature_2m_min: 12,
        precipitation_sum: 2,
        precipitation_probability_max: 20,
        wind_speed_10m_max: 10,
    }), ["thunderstorms"]);
    assert.deepEqual(getWeatherConditions({
        weather_code: 1,
        temperature_2m_max: 24,
        temperature_2m_min: 12,
        precipitation_sum: 0,
        precipitation_probability_max: 10,
        wind_speed_10m_max: 10,
    }), []);
});

test("suggests alternatives according to the forecast risks", () => {
    const suggestions = getActivitySuggestions(["rain", "strong wind"]);
    assert.ok(suggestions.some((suggestion) => suggestion.includes("museums")));
    assert.ok(suggestions.some((suggestion) => suggestion.includes("boat activity")));
});

test("returns trip forecasts with weather risks and alternatives", async () => {
    const now = new Date("2030-03-01T12:00:00.000Z");
    const calls = [];
    const forecast = await getTripWeatherForecast({
        destination: "Goa",
        startDate: new Date("2030-03-02T00:00:00.000Z"),
        endDate: new Date("2030-03-02T00:00:00.000Z"),
    }, {
        now,
        fetchImpl: async (url) => {
            const parsedUrl = new URL(url);
            calls.push(parsedUrl);
            if (parsedUrl.hostname === "geocoding-api.open-meteo.com") {
                return { ok: true, json: async () => ({ results: [{ latitude: 15.5, longitude: 73.8 }] }) };
            }
            return {
                ok: true,
                json: async () => ({
                    daily: {
                        time: ["2030-03-02"],
                        weather_code: [61],
                        temperature_2m_max: [29],
                        temperature_2m_min: [22],
                        precipitation_sum: [12],
                        precipitation_probability_max: [80],
                        wind_speed_10m_max: [12],
                    },
                }),
            };
        },
    });

    assert.equal(forecast.forecastAvailable, true);
    assert.equal(forecast.forecast[0].date, "2030-03-02");
    assert.deepEqual(forecast.forecast[0].conditions, ["rain"]);
    assert.ok(forecast.forecast[0].suggestions.some((suggestion) => suggestion.includes("museums")));
    const forecastUrl = calls.find((url) => url.hostname === "api.open-meteo.com");
    assert.equal(forecastUrl.searchParams.get("start_date"), "2030-03-02");
    assert.equal(forecastUrl.searchParams.get("end_date"), "2030-03-02");
});

test("explains when trip dates are outside Open-Meteo's forecast window", async () => {
    let fetchCalled = false;
    const result = await getTripWeatherForecast({
        destination: "Tokyo",
        startDate: new Date("2030-04-01T00:00:00.000Z"),
        endDate: new Date("2030-04-02T00:00:00.000Z"),
    }, {
        now: new Date("2030-03-01T12:00:00.000Z"),
        fetchImpl: async () => {
            fetchCalled = true;
            throw new Error("Should not fetch dates outside the forecast window");
        },
    });

    assert.equal(result.forecastAvailable, false);
    assert.match(result.message, /next 16 days/i);
    assert.equal(fetchCalled, false);
});

test("uses archived weather for past trips and Jaipur for a Rajasthan regional estimate", async () => {
    const urls = [];
    const result = await getTripWeatherForecast({
        destination: "Rajasthan",
        startDate: new Date("2030-03-01T00:00:00.000Z"),
        endDate: new Date("2030-03-02T00:00:00.000Z"),
    }, {
        now: new Date("2030-03-05T12:00:00.000Z"),
        fetchImpl: async (url) => {
            const parsedUrl = new URL(url);
            urls.push(parsedUrl);
            if (parsedUrl.hostname === "geocoding-api.open-meteo.com") {
                return { ok: true, json: async () => ({}) };
            }
            return {
                ok: true,
                json: async () => ({
                    daily: {
                        time: ["2030-03-01", "2030-03-02"],
                        weather_code: [0, 61],
                        temperature_2m_max: [31, 28],
                        temperature_2m_min: [18, 19],
                        precipitation_sum: [0, 11],
                        wind_speed_10m_max: [8, 12],
                    },
                }),
            };
        },
    });

    const geocodingUrl = urls.find((url) => url.hostname === "geocoding-api.open-meteo.com");
    const archiveUrl = urls.find((url) => url.hostname === "archive-api.open-meteo.com");
    assert.equal(geocodingUrl.searchParams.get("name"), "Rajasthan");
    assert.equal(archiveUrl.searchParams.get("latitude"), "26.9124");
    assert.equal(archiveUrl.searchParams.get("longitude"), "75.7873");
    assert.equal(archiveUrl.searchParams.get("start_date"), "2030-03-01");
    assert.equal(archiveUrl.searchParams.get("end_date"), "2030-03-02");
    assert.equal(archiveUrl.searchParams.has("precipitation_probability_max"), false);
    assert.equal(result.forecastType, "historical");
    assert.equal(result.weatherLocation, "Jaipur (regional estimate for Rajasthan)");
    assert.equal(result.forecast[0].precipitationProbability, undefined);
    assert.deepEqual(result.forecast[1].conditions, ["rain"]);
});

test("creates one deduplicated notification and marks it resolved when conditions improve", async () => {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + 1);
    const tripDate = day.toISOString().slice(0, 10);
    const records = new Map();
    const updates = [];
    const calls = [];
    const forecastUrls = [];
    const TripModel = {
        find: () => ({
            lean: async () => [{
                _id: "trip-1",
                user: "user-1",
                destination: "Reykjavik",
                startDate: new Date(`${tripDate}T00:00:00.000Z`),
                endDate: new Date(`${tripDate}T00:00:00.000Z`),
                itinerary: [{
                    date: tripDate,
                    activities: [{ title: "Outdoor walking tour" }, { title: "Lunch" }],
                }],
            }],
        }),
    };
    const NotificationModel = {
        findOneAndUpdate: async (filter, update) => {
            records.set(filter.dedupeKey, update.$set);
            updates.push(update);
        },
        updateOne: async (filter, update) => {
            calls.push({ filter, update });
        },
    };
    let isBadWeather = true;
    const fetchImpl = async (url) => {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === "geocoding-api.open-meteo.com") {
            return { ok: true, json: async () => ({ results: [{ latitude: 64.1, longitude: -21.9 }] }) };
        }
        forecastUrls.push(parsedUrl);
        return {
            ok: true,
            json: async () => ({
                daily: {
                    time: [tripDate],
                    weather_code: [isBadWeather ? 61 : 1],
                    temperature_2m_max: [12],
                    temperature_2m_min: [5],
                    precipitation_sum: [isBadWeather ? 14 : 0],
                    precipitation_probability_max: [isBadWeather ? 80 : 10],
                    wind_speed_10m_max: [isBadWeather ? 18 : 10],
                },
            }),
        };
    };

    const firstResult = await checkTripWeather({ TripModel, NotificationModel, fetchImpl });
    assert.equal(firstResult.checkedTrips, 1);
    assert.equal(firstResult.createdOrUpdatedAlerts, 1);
    assert.equal(records.size, 1);
    assert.equal(forecastUrls[0].searchParams.get("start_date"), tripDate);
    assert.equal(forecastUrls[0].searchParams.get("end_date"), tripDate);
    assert.equal(forecastUrls[0].searchParams.has("forecast_days"), false);
    assert.deepEqual(records.get(`trip-1:${tripDate}`).conditions, ["rain"]);
    assert.deepEqual(records.get(`trip-1:${tripDate}`).affectedActivities, ["Outdoor walking tour"]);
    assert.equal(updates[0].$setOnInsert.read, false);

    isBadWeather = false;
    await checkTripWeather({ TripModel, NotificationModel, fetchImpl });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].update.$set.resolvedAt instanceof Date, true);
});

test("logs an API failure for one trip without failing the scheduled check", async () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args);
    const TripModel = {
        find: () => ({
            lean: async () => [{
                _id: "trip-error",
                user: "user-1",
                destination: "Unknown",
                startDate: new Date(Date.now() + 86400000),
                endDate: new Date(Date.now() + 86400000),
            }],
        }),
    };
    try {
        const result = await checkTripWeather({
            TripModel,
            NotificationModel: {},
            fetchImpl: async () => ({ ok: false, status: 503 }),
        });
        assert.deepEqual(result, { checkedTrips: 0, createdOrUpdatedAlerts: 0 });
        assert.equal(logged.length, 1);
        assert.match(logged[0][0], /trip-error/);
    } finally {
        console.error = originalError;
    }
});
