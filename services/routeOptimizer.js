const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const DEFAULT_OSRM_URL = "https://router.project-osrm.org";
const MAX_STOPS = 8;
const OBJECTIVES = new Set(["balanced", "time", "distance", "cost"]);
const COST_PER_KILOMETER_INR = 12;
const REQUEST_TIMEOUT_MS = 15000;

const createRouteError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const getLegCost = (distanceMeters) => (
    (distanceMeters / 1000) * COST_PER_KILOMETER_INR
);

const getObjectiveWeights = (objective) => {
    if (objective === "time") return { time: 1, distance: 0, cost: 0 };
    if (objective === "distance") return { time: 0, distance: 1, cost: 0 };
    if (objective === "cost") return { time: 0, distance: 0, cost: 1 };
    return { time: 0.5, distance: 0.3, cost: 0.2 };
};

const findOptimalStopOrder = ({ stopCount, matrix, objective }) => {
    const weights = getObjectiveWeights(objective);
    let maxDuration = 1;
    let maxDistance = 1;

    matrix.forEach((row) => row.forEach((leg) => {
        if (!leg) return;
        maxDuration = Math.max(maxDuration, leg.durationSeconds);
        maxDistance = Math.max(maxDistance, leg.distanceMeters);
    }));

    const legScore = (leg) => (
        weights.time * (leg.durationSeconds / maxDuration)
        + weights.distance * (leg.distanceMeters / maxDistance)
        + weights.cost * (getLegCost(leg.distanceMeters) / getLegCost(maxDistance))
    );

    const stateCount = 1 << stopCount;
    const best = Array.from({ length: stateCount }, () => Array(stopCount).fill(null));

    for (let stop = 0; stop < stopCount; stop += 1) {
        const firstLeg = matrix[0][stop + 1];
        if (firstLeg) {
            best[1 << stop][stop] = { score: legScore(firstLeg), order: [stop] };
        }
    }

    for (let mask = 1; mask < stateCount; mask += 1) {
        for (let last = 0; last < stopCount; last += 1) {
            const current = best[mask][last];
            if (!current) continue;

            for (let next = 0; next < stopCount; next += 1) {
                if (mask & (1 << next)) continue;
                const leg = matrix[last + 1][next + 1];
                if (!leg) continue;

                const nextMask = mask | (1 << next);
                const candidate = { score: current.score + legScore(leg), order: [...current.order, next] };
                const existing = best[nextMask][next];
                if (!existing || candidate.score < existing.score) best[nextMask][next] = candidate;
            }
        }
    }

    const completeRoutes = best[stateCount - 1].filter(Boolean);
    if (!completeRoutes.length) {
        throw createRouteError("OpenStreetMap could not find a drivable route through all selected stops.", 422);
    }
    completeRoutes.sort((first, second) => first.score - second.score);

    const order = completeRoutes[0].order;
    const legs = [];
    let currentPoint = 0;
    for (const stopIndex of order) {
        legs.push(matrix[currentPoint][stopIndex + 1]);
        currentPoint = stopIndex + 1;
    }
    return { order, legs };
};

const getManeuverInstruction = (step) => {
    const maneuver = step.maneuver || {};
    const type = String(maneuver.type || "continue").replace(/_/g, " ");
    const modifier = String(maneuver.modifier || "").replace(/_/g, " ");
    const road = step.name ? ` onto ${step.name}` : "";
    const direction = modifier ? ` ${modifier}` : "";
    return `${type}${direction}${road}`.replace(/^./, (character) => character.toUpperCase());
};

const createRouteOptimizer = ({
    fetchImpl = (...args) => fetch(...args),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = () => Date.now(),
    osrmBaseUrl = () => process.env.OSRM_BASE_URL?.trim() || DEFAULT_OSRM_URL,
    geocodeIntervalMs = 1100,
} = {}) => {
    const geocodeCache = new Map();
    let lastGeocodeAt = null;
    let geocodeQueue = Promise.resolve();

    const fetchJson = async (url, options, serviceName) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let response;
        try {
            response = await fetchImpl(url, { ...options, signal: controller.signal });
        } catch (cause) {
            const detail = cause.name === "AbortError"
                ? "The request timed out."
                : cause.message;
            throw createRouteError(`${serviceName} is unavailable: ${detail} Please retry shortly.`, 502);
        } finally {
            clearTimeout(timeout);
        }

        let payload;
        try {
            payload = await response.json();
        } catch (cause) {
            throw createRouteError(`${serviceName} returned an unreadable response. Please retry shortly.`, 502);
        }

        if (!response.ok) {
            const rateLimit = response.status === 429
                ? " The public service is rate limiting requests; wait a moment before retrying."
                : "";
            throw createRouteError(
                `${serviceName} request failed (HTTP ${response.status}).${rateLimit}`,
                response.status === 429 ? 429 : 502
            );
        }
        return payload;
    };

    const geocode = (query) => {
        const cacheKey = query.trim().toLowerCase();
        if (geocodeCache.has(cacheKey)) return Promise.resolve(geocodeCache.get(cacheKey));

        const task = geocodeQueue.then(async () => {
            if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey);

            const wait = lastGeocodeAt === null
                ? 0
                : Math.max(0, geocodeIntervalMs - (now() - lastGeocodeAt));
            if (wait > 0) await sleep(wait);
            lastGeocodeAt = now();

            const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1" });
            const results = await fetchJson(
                `${NOMINATIM_URL}/search?${params}`,
                {
                    headers: {
                        "User-Agent": "TripAITravelPlanner/1.0",
                        "Accept-Language": "en",
                    },
                },
                "OpenStreetMap geocoding"
            );
            const result = results[0];
            const latitude = Number(result?.lat);
            const longitude = Number(result?.lon);
            if (!result || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                throw createRouteError(
                    `Could not find “${query}” on OpenStreetMap. Check the place name and try again.`,
                    422
                );
            }

            const location = { latitude, longitude, displayName: result.display_name || query };
            geocodeCache.set(cacheKey, location);
            return location;
        });
        geocodeQueue = task.catch(() => {});
        return task;
    };

    const optimizeRoute = async ({ origin, stops, travelMode = "DRIVE", objective = "balanced" } = {}) => {
        if (typeof origin !== "string" || !origin.trim() || origin.trim().length > 120) {
            throw createRouteError("Enter a starting point (up to 120 characters).", 400);
        }
        if (!Array.isArray(stops) || stops.length < 2 || stops.length > MAX_STOPS) {
            throw createRouteError(`Select between 2 and ${MAX_STOPS} unique stops to optimize a route.`, 400);
        }
        if (stops.some((stop) => typeof stop !== "string" || !stop.trim() || stop.trim().length > 120)) {
            throw createRouteError("Each route stop must be a place name up to 120 characters.", 400);
        }
        const normalizedStops = stops.map((stop) => stop.trim());
        if (new Set(normalizedStops.map((stop) => stop.toLowerCase())).size !== normalizedStops.length) {
            throw createRouteError("Remove duplicate stops before optimizing the route.", 400);
        }
        if (travelMode !== "DRIVE") {
            throw createRouteError("The free public OSRM routing server supports driving routes only.", 400);
        }
        if (!OBJECTIVES.has(objective)) {
            throw createRouteError("Choose a supported route optimization objective.", 400);
        }

        const addresses = [origin.trim(), ...normalizedStops.map((stop) => (
            stop.toLowerCase().includes(origin.trim().toLowerCase())
                ? stop
                : `${stop}, ${origin.trim()}`
        ))];
        const locations = await Promise.all(addresses.map(geocode));
        const coordinates = locations.map(({ longitude, latitude }) => `${longitude},${latitude}`);
        const baseUrl = osrmBaseUrl().replace(/\/+$/, "");

        const matrixUrl = `${baseUrl}/table/v1/driving/${coordinates.join(";")}?sources=all&destinations=all&annotations=distance,duration`;
        const matrixResponse = await fetchJson(matrixUrl, {}, "OSRM route matrix");
        if (
            matrixResponse.code !== "Ok"
            || !Array.isArray(matrixResponse.distances)
            || !Array.isArray(matrixResponse.durations)
        ) {
            throw createRouteError(
                `OSRM could not connect the selected places to a drivable road${matrixResponse.message ? `: ${matrixResponse.message}` : "."}`,
                422
            );
        }

        const pointCount = locations.length;
        const matrix = Array.from({ length: pointCount }, (_, originIndex) => (
            Array.from({ length: pointCount }, (_, destinationIndex) => {
                if (originIndex === destinationIndex) return null;
                const distanceMeters = matrixResponse.distances[originIndex]?.[destinationIndex];
                const durationSeconds = matrixResponse.durations[originIndex]?.[destinationIndex];
                if (
                    !Number.isFinite(distanceMeters)
                    || distanceMeters < 0
                    || !Number.isFinite(durationSeconds)
                    || durationSeconds < 0
                ) return null;
                return { distanceMeters, durationSeconds };
            })
        ));

        const { order, legs: optimizedLegs } = findOptimalStopOrder({
            stopCount: normalizedStops.length,
            matrix,
            objective,
        });
        const orderedStops = order.map((index) => normalizedStops[index]);
        const orderedLocations = order.map((index) => locations[index + 1]);
        const orderedCoordinates = [locations[0], ...orderedLocations]
            .map(({ longitude, latitude }) => `${longitude},${latitude}`)
            .join(";");
        const routeUrl = `${baseUrl}/route/v1/driving/${orderedCoordinates}?overview=full&steps=true&geometries=geojson`;
        const routeResponse = await fetchJson(routeUrl, {}, "OSRM directions");
        const route = routeResponse.routes?.[0];

        if (
            routeResponse.code !== "Ok"
            || !route
            || !Array.isArray(route.geometry?.coordinates)
            || !Array.isArray(route.legs)
            || route.legs.length !== orderedStops.length
        ) {
            throw createRouteError(
                `OSRM could not return complete directions${routeResponse.message ? `: ${routeResponse.message}` : "."}`,
                422
            );
        }

        const distanceMeters = Number(route.distance);
        const durationSeconds = Number(route.duration);
        if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
            throw createRouteError("OSRM returned invalid route distance or travel time.", 502);
        }

        const directions = route.legs.map((leg, index) => ({
            from: index === 0 ? origin.trim() : orderedStops[index - 1],
            to: orderedStops[index],
            distanceMeters: Number(leg.distance) || 0,
            durationSeconds: Number(leg.duration) || 0,
            startLocation: {
                latitude: orderedLocations[index - 1]?.latitude ?? locations[0].latitude,
                longitude: orderedLocations[index - 1]?.longitude ?? locations[0].longitude,
            },
            endLocation: {
                latitude: orderedLocations[index].latitude,
                longitude: orderedLocations[index].longitude,
            },
            steps: (leg.steps || []).map((step) => ({
                instruction: getManeuverInstruction(step),
                distanceMeters: Number(step.distance) || 0,
                durationSeconds: Number(step.duration) || 0,
            })),
        }));

        return {
            origin: origin.trim(),
            stops: orderedStops.map((name, index) => ({
                name,
                order: index + 1,
                location: orderedLocations[index],
            })),
            summary: {
                distanceMeters,
                durationSeconds,
                estimatedCostInr: getLegCost(distanceMeters),
                travelMode: "DRIVE",
                objective,
                algorithm: "Held-Karp dynamic programming",
                estimatedCostNote: "Indicative driving estimate at ₹12/km; actual fuel, tolls, and parking may vary.",
            },
            route: {
                coordinates: route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
                waypoints: [locations[0], ...orderedLocations].map((location) => ({
                    name: location.displayName,
                    location: { latitude: location.latitude, longitude: location.longitude },
                })),
                directions,
                matrixDistanceMeters: optimizedLegs.reduce((total, leg) => total + leg.distanceMeters, 0),
                matrixDurationSeconds: optimizedLegs.reduce((total, leg) => total + leg.durationSeconds, 0),
            },
        };
    };

    return { optimizeRoute };
};

const { optimizeRoute } = createRouteOptimizer();

module.exports = {
    createRouteOptimizer,
    findOptimalStopOrder,
    optimizeRoute,
};
