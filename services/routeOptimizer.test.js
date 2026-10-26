const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRouteOptimizer, findOptimalStopOrder } = require("./routeOptimizer");

const durations = [
    [0, 10, 2],
    [0, 0, 100],
    [0, 2, 0],
];
const distances = [
    [0, 1000, 10000],
    [0, 0, 1000],
    [0, 1000, 0],
];

const makeLocations = (count) => Array.from({ length: count }, (_, index) => ({
    latitude: 15 + (index / 100),
    longitude: 73 + (index / 100),
}));

const createOptimizer = ({ fetchImpl, geocodeIntervalMs = 0 } = {}) => {
    const requests = [];
    let geocodeIndex = 0;
    const optimizer = createRouteOptimizer({
        sleep: async () => {},
        now: () => 10000,
        geocodeIntervalMs,
        fetchImpl: fetchImpl || (async (url, options = {}) => {
            requests.push({ url, options });
            if (url.includes("/search?")) {
                const location = makeLocations(3)[geocodeIndex];
                geocodeIndex += 1;
                return {
                    ok: true,
                    json: async () => [{
                        lat: String(location.latitude),
                        lon: String(location.longitude),
                        display_name: `OSM ${location.latitude}, ${location.longitude}`,
                    }],
                };
            }
            if (url.includes("/table/")) {
                return {
                    ok: true,
                    json: async () => ({
                        code: "Ok",
                        durations,
                        distances,
                    }),
                };
            }
            if (url.includes("/route/")) {
                const waypoints = makeLocations(3);
                return {
                    ok: true,
                    json: async () => ({
                        code: "Ok",
                        waypoints: waypoints.map((location, index) => ({
                            name: `Point ${index}`,
                            location: [location.longitude, location.latitude],
                        })),
                        routes: [{
                            distance: 12000,
                            duration: 900,
                            geometry: {
                                coordinates: [
                                    [73, 15],
                                    [73.1, 15.1],
                                    [73.2, 15.2],
                                ],
                            },
                            legs: [{
                                distance: 5000,
                                duration: 400,
                                steps: [{
                                    distance: 5000,
                                    duration: 400,
                                    name: "Margao Road",
                                    maneuver: { type: "turn", modifier: "left" },
                                }],
                            }, {
                                distance: 7000,
                                duration: 500,
                                steps: [],
                            }],
                        }],
                    }),
                };
            }
            throw new Error(`Unexpected URL: ${url}`);
        }),
    });
    return { ...optimizer, requests };
};

test("optimizes stop ordering by time or distance using exact dynamic programming", () => {
    const matrix = Array.from({ length: 3 }, (_, originIndex) => (
        Array.from({ length: 3 }, (_, destinationIndex) => (
            originIndex === destinationIndex
                ? null
                : {
                      durationSeconds: durations[originIndex][destinationIndex],
                      distanceMeters: distances[originIndex][destinationIndex],
                  }
        ))
    ));

    assert.deepEqual(findOptimalStopOrder({ stopCount: 2, matrix, objective: "time" }).order, [1, 0]);
    assert.deepEqual(findOptimalStopOrder({ stopCount: 2, matrix, objective: "distance" }).order, [0, 1]);
    assert.deepEqual(findOptimalStopOrder({ stopCount: 2, matrix, objective: "cost" }).order, [0, 1]);
});

test("geocodes places, optimizes the OSRM matrix, and returns map coordinates and directions", async () => {
    const { optimizeRoute, requests } = createOptimizer();

    const result = await optimizeRoute({
        origin: "Panaji, Goa",
        stops: ["Fort Aguada", "Fontainhas"],
        objective: "time",
    });

    assert.deepEqual(result.stops.map((stop) => stop.name), ["Fontainhas", "Fort Aguada"]);
    assert.equal(result.summary.algorithm, "Held-Karp dynamic programming");
    assert.equal(result.summary.distanceMeters, 12000);
    assert.equal(result.summary.durationSeconds, 900);
    assert.equal(result.summary.estimatedCostInr, 144);
    assert.equal(result.summary.travelMode, "DRIVE");
    assert.deepEqual(result.route.coordinates, [[15, 73], [15.1, 73.1], [15.2, 73.2]]);
    assert.equal(result.route.directions[0].steps[0].instruction, "Turn left onto Margao Road");
    assert.equal(result.route.directions[0].startLocation.latitude, 15);
    assert.equal(result.route.directions[0].endLocation.latitude, 15.02);
    assert.equal(result.route.waypoints.length, 3);
    assert.equal(requests.filter(({ url }) => url.includes("/search?")).length, 3);
    assert.match(requests[0].url, /nominatim\.openstreetmap\.org\/search/);
    assert.equal(requests[0].options.headers["User-Agent"], "TripAITravelPlanner/1.0");
    assert.match(requests[3].url, /router\.project-osrm\.org\/table\/v1\/driving/);
    assert.match(requests[4].url, /router\.project-osrm\.org\/route\/v1\/driving/);
    assert.match(requests[4].url, /steps=true/);
    assert.equal(result.summary.estimatedCostNote.includes("₹12/km"), true);
});

test("rejects duplicate stops and unsupported public OSRM travel modes", async () => {
    const { optimizeRoute, requests } = createOptimizer();

    await assert.rejects(
        optimizeRoute({ origin: "Goa", stops: ["A", "a"] }),
        { statusCode: 400 }
    );
    await assert.rejects(
        optimizeRoute({ origin: "Goa", stops: ["A", "B"], travelMode: "WALK" }),
        { statusCode: 400, message: /driving routes only/i }
    );
    assert.equal(requests.length, 0);
});

test("reports unknown places and public geocoder rate limits", async () => {
    const missingPlace = createRouteOptimizer({
        geocodeIntervalMs: 0,
        fetchImpl: async () => ({ ok: true, json: async () => [] }),
    });
    await assert.rejects(
        missingPlace.optimizeRoute({ origin: "Unknown place", stops: ["A", "B"] }),
        { statusCode: 422, message: /Could not find/i }
    );

    const rateLimited = createRouteOptimizer({
        geocodeIntervalMs: 0,
        fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }),
    });
    await assert.rejects(
        rateLimited.optimizeRoute({ origin: "Goa", stops: ["A", "B"] }),
        { statusCode: 429, message: /rate limiting requests/i }
    );
});

test("reports OSRM no-route responses, network errors, and malformed route responses", async () => {
    const noRoute = createRouteOptimizer({
        geocodeIntervalMs: 0,
        fetchImpl: async (url) => {
            if (url.includes("/search?")) {
                const placeIndex = new URL(url).searchParams.get("q") === "Goa" ? 0 : 1;
                const location = makeLocations(3)[placeIndex];
                return {
                    ok: true,
                    json: async () => [{ lat: String(location.latitude), lon: String(location.longitude) }],
                };
            }
            return { ok: true, json: async () => ({ code: "NoRoute", message: "No route found" }) };
        },
    });
    await assert.rejects(
        noRoute.optimizeRoute({ origin: "Goa", stops: ["A", "B"] }),
        { statusCode: 422, message: /OSRM could not connect/i }
    );

    const unavailable = createRouteOptimizer({
        geocodeIntervalMs: 0,
        fetchImpl: async () => {
            throw new Error("network unavailable");
        },
    });
    await assert.rejects(
        unavailable.optimizeRoute({ origin: "Goa", stops: ["A", "B"] }),
        { statusCode: 502, message: /OpenStreetMap geocoding is unavailable: network unavailable/i }
    );

    const malformedRoute = createOptimizer({
        fetchImpl: async (url) => {
            if (url.includes("/search?")) {
                const location = makeLocations(3)[new URL(url).searchParams.get("q") === "Panaji, Goa" ? 0 : 1];
                return { ok: true, json: async () => [{ lat: String(location.latitude), lon: String(location.longitude) }] };
            }
            if (url.includes("/table/")) {
                const compatibleDistances = [
                    [0, 1000, 1000],
                    [1000, 0, 1000],
                    [1000, 1000, 0],
                ];
                const compatibleDurations = [
                    [0, 10, 10],
                    [10, 0, 10],
                    [10, 10, 0],
                ];
                return {
                    ok: true,
                    json: async () => ({ code: "Ok", distances: compatibleDistances, durations: compatibleDurations }),
                };
            }
            return { ok: true, json: async () => ({ code: "Ok", routes: [] }) };
        },
    });
    await assert.rejects(
        malformedRoute.optimizeRoute({ origin: "Panaji, Goa", stops: ["A", "B"] }),
        { statusCode: 422, message: /OSRM could not return complete directions/i }
    );
});

test("respects Nominatim request spacing and caches geocoded places", async () => {
    let clock = 0;
    const waits = [];
    let geocodeCalls = 0;
    const matrix = Array.from({ length: 3 }, (_, index) => (
        Array.from({ length: 3 }, (_, otherIndex) => (index === otherIndex ? 0 : 1000))
    ));
    const seconds = Array.from({ length: 3 }, (_, index) => (
        Array.from({ length: 3 }, (_, otherIndex) => (index === otherIndex ? 0 : 60))
    ));
    const optimizer = createRouteOptimizer({
        now: () => clock,
        sleep: async (milliseconds) => {
            waits.push(milliseconds);
            clock += milliseconds;
        },
        geocodeIntervalMs: 1100,
        fetchImpl: async (url) => {
            if (url.includes("/search?")) {
                geocodeCalls += 1;
                const placeIndex = new URL(url).searchParams.get("q") === "Goa" ? 0 : geocodeCalls - 1;
                const location = makeLocations(3)[placeIndex];
                return {
                    ok: true,
                    json: async () => [{ lat: String(location.latitude), lon: String(location.longitude) }],
                };
            }
            if (url.includes("/table/")) {
                return { ok: true, json: async () => ({ code: "Ok", distances: matrix, durations: seconds }) };
            }
            return {
                ok: true,
                json: async () => ({
                    code: "Ok",
                    routes: [{
                        distance: 2000,
                        duration: 120,
                        geometry: { coordinates: [[73, 15], [73.01, 15.01]] },
                        legs: [
                            { distance: 1000, duration: 60 },
                            { distance: 1000, duration: 60 },
                        ],
                    }],
                }),
            };
        },
    });

    await optimizer.optimizeRoute({ origin: "Goa", stops: ["Place A", "Place B"] });
    assert.equal(geocodeCalls, 3);
    assert.deepEqual(waits, [1100, 1100]);

    await optimizer.optimizeRoute({ origin: "Goa", stops: ["Place A", "Place B"] });
    assert.equal(geocodeCalls, 3);
    assert.deepEqual(waits, [1100, 1100]);
});

test("rejects unreachable legs instead of returning an incomplete route", () => {
    const matrix = Array.from({ length: 3 }, () => Array(3).fill(null));
    assert.throws(
        () => findOptimalStopOrder({ stopCount: 2, matrix, objective: "balanced" }),
        { statusCode: 422 }
    );
});
