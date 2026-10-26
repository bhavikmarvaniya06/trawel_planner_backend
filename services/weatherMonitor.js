const Trip = require("../models/Trip");
const Notification = require("../models/Notification");

const FORECAST_DAYS = 16;
const REQUEST_TIMEOUT_MS = 10000;
const OUTDOOR_ACTIVITY_PATTERN = /outdoor|hike|beach|boat|walk|cycle|park|garden|sightseeing|market/i;
const DESTINATION_COORDINATE_FALLBACKS = {
    rajasthan: {
        latitude: 26.9124,
        longitude: 75.7873,
        label: "Jaipur (regional estimate for Rajasthan)",
    },
};

const toFiniteNumber = (value) => {
    if (value === null || value === undefined || value === "") return Number.NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
};

const toOptionalFiniteNumber = (value) => {
    const number = toFiniteNumber(value);
    return Number.isFinite(number) ? number : undefined;
};

const requestJson = async (url, fetchImpl = fetch) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetchImpl(url, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Open-Meteo returned HTTP ${response.status}`);
        }
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
};

const getCoordinates = async (destination, fetchImpl) => {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", destination);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "en");
    url.searchParams.set("format", "json");

    const result = await requestJson(url, fetchImpl);
    const place = result.results?.[0];
    if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
        const fallback = DESTINATION_COORDINATE_FALLBACKS[destination.trim().toLowerCase()];
        if (fallback) return fallback;
        throw new Error(`Open-Meteo could not find coordinates for "${destination}"`);
    }
    return {
        latitude: place.latitude,
        longitude: place.longitude,
        label: place.name,
    };
};

const getForecast = async (coordinates, startDate, endDate, fetchImpl, historical = false) => {
    const url = new URL(
        historical
            ? "https://archive-api.open-meteo.com/v1/archive"
            : "https://api.open-meteo.com/v1/forecast"
    );
    url.searchParams.set("latitude", String(coordinates.latitude));
    url.searchParams.set("longitude", String(coordinates.longitude));
    url.searchParams.set("daily", [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "wind_speed_10m_max",
        ...(!historical ? ["precipitation_probability_max"] : []),
    ].join(","));
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    return requestJson(url, fetchImpl);
};

const getWeatherConditions = (day) => {
    const conditions = [];
    const code = toFiniteNumber(day.weather_code);
    const precipitation = toFiniteNumber(day.precipitation_sum);
    const precipitationProbability = toFiniteNumber(day.precipitation_probability_max);
    const windSpeed = toFiniteNumber(day.wind_speed_10m_max);
    const temperatureMax = toFiniteNumber(day.temperature_2m_max);
    const temperatureMin = toFiniteNumber(day.temperature_2m_min);

    if ([95, 96, 99].includes(code)) {
        conditions.push("thunderstorms");
    } else if (
        (Number.isFinite(precipitationProbability) && precipitationProbability >= 60)
        || (Number.isFinite(precipitation) && precipitation >= 10)
        || ((code >= 51 && code <= 67) || (code >= 80 && code <= 82))
    ) {
        conditions.push("rain");
    }
    if (Number.isFinite(windSpeed) && windSpeed >= 50) conditions.push("strong wind");
    if (Number.isFinite(temperatureMax) && temperatureMax >= 35) conditions.push("extreme heat");
    if (Number.isFinite(temperatureMin) && temperatureMin <= 0) conditions.push("freezing temperatures");

    return conditions;
};

const getActivitySuggestions = (conditions) => {
    const suggestions = new Set();
    if (conditions.includes("thunderstorms")) {
        suggestions.add("Move outdoor plans indoors and avoid exposed areas during thunderstorms.");
        suggestions.add("Consider museums, galleries, covered markets, or a cooking class.");
    } else if (conditions.includes("rain")) {
        suggestions.add("Swap outdoor sightseeing for museums, galleries, covered markets, or a cooking class.");
        suggestions.add("Reschedule walking tours and outdoor stops for a drier day.");
    }
    if (conditions.includes("extreme heat")) {
        suggestions.add("Plan outdoor activities early or late, take shade and water breaks, and consider air-conditioned attractions.");
    }
    if (conditions.includes("freezing temperatures")) {
        suggestions.add("Add warm indoor breaks such as museums, cafes, or covered attractions.");
    }
    if (conditions.includes("strong wind")) {
        suggestions.add("Check outdoor and boat activity conditions; consider a sheltered indoor alternative.");
    }
    return [...suggestions];
};

const getTripWeatherForecast = async (trip, { fetchImpl = fetch, now = new Date() } = {}) => {
    const today = getUtcDate(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const lastForecastDate = new Date(todayDate);
    lastForecastDate.setUTCDate(lastForecastDate.getUTCDate() + FORECAST_DAYS - 1);
    const lastForecastDay = getUtcDate(lastForecastDate);
    const tripStart = getUtcDate(trip.startDate);
    const tripEnd = getUtcDate(trip.endDate);

    const historical = tripEnd < today;
    if (!historical && tripStart > lastForecastDay) {
        return {
            forecastAvailable: false,
            message: `Forecasts are available for the next ${FORECAST_DAYS} days. Check back closer to your trip.`,
            forecast: [],
        };
    }

    const forecastStart = historical ? tripStart : tripStart < today ? today : tripStart;
    const forecastEnd = historical ? tripEnd : tripEnd > lastForecastDay ? lastForecastDay : tripEnd;
    const coordinates = await getCoordinates(trip.destination, fetchImpl);
    const result = await getForecast(coordinates, forecastStart, forecastEnd, fetchImpl, historical);
    if (!Array.isArray(result.daily?.time)) {
        throw new Error("Open-Meteo returned an invalid daily forecast");
    }

    const forecast = result.daily.time.map((date, index) => {
        const day = {
            weather_code: result.daily.weather_code?.[index],
            temperature_2m_max: result.daily.temperature_2m_max?.[index],
            temperature_2m_min: result.daily.temperature_2m_min?.[index],
            precipitation_sum: result.daily.precipitation_sum?.[index],
            precipitation_probability_max: result.daily.precipitation_probability_max?.[index],
            wind_speed_10m_max: result.daily.wind_speed_10m_max?.[index],
        };
        const conditions = getWeatherConditions(day);

        return {
            date,
            temperatureMax: toOptionalFiniteNumber(day.temperature_2m_max),
            temperatureMin: toOptionalFiniteNumber(day.temperature_2m_min),
            precipitation: toOptionalFiniteNumber(day.precipitation_sum),
            precipitationProbability: toOptionalFiniteNumber(day.precipitation_probability_max),
            windSpeed: toOptionalFiniteNumber(day.wind_speed_10m_max),
            weatherCode: toOptionalFiniteNumber(day.weather_code),
            conditions,
            suggestions: getActivitySuggestions(conditions),
        };
    });

    return {
        forecastAvailable: true,
        forecast,
        forecastThrough: forecastEnd,
        forecastType: historical ? "historical" : "forecast",
        weatherLocation: coordinates.label || trip.destination,
    };
};

const getAffectedActivities = (trip, tripDate) => {
    const activities = (trip.itinerary || []).flatMap((day) => {
        if (day.date) {
            const date = new Date(day.date);
            if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) !== tripDate) return [];
        }
        return (day.activities || []).map((activity) => (
            typeof activity === "string"
                ? activity
                : activity && typeof activity === "object"
                    ? activity.title || activity.name || activity.description || ""
                    : ""
        ));
    });
    return activities
        .filter((activity) => OUTDOOR_ACTIVITY_PATTERN.test(activity))
        .slice(0, 5);
};

const getUtcDate = (date) => new Date(date).toISOString().slice(0, 10);

const checkTripWeather = async ({
    TripModel = Trip,
    NotificationModel = Notification,
    fetchImpl = fetch,
    now = new Date(),
} = {}) => {
    const today = getUtcDate(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const lastForecastDate = new Date(todayDate);
    lastForecastDate.setUTCDate(lastForecastDate.getUTCDate() + FORECAST_DAYS - 1);
    const lastForecastDay = getUtcDate(lastForecastDate);
    const trips = await TripModel.find({
        status: { $in: ["planned", "booked"] },
        endDate: { $gte: todayDate },
    }).lean();
    const coordinatesByDestination = new Map();
    let checkedTrips = 0;
    let createdOrUpdatedAlerts = 0;

    for (const trip of trips) {
        try {
            const tripStart = getUtcDate(trip.startDate);
            const tripEnd = getUtcDate(trip.endDate);
            if (tripStart > lastForecastDay) continue;

            const forecastStart = tripStart < today ? today : tripStart;
            const forecastEnd = tripEnd > lastForecastDay ? lastForecastDay : tripEnd;
            if (!coordinatesByDestination.has(trip.destination)) {
                coordinatesByDestination.set(
                    trip.destination,
                    getCoordinates(trip.destination, fetchImpl)
                );
            }
            const coordinates = await coordinatesByDestination.get(trip.destination);
            const forecast = await getForecast(coordinates, forecastStart, forecastEnd, fetchImpl);
            const daily = forecast.daily;
            if (!Array.isArray(daily?.time)) {
                throw new Error("Open-Meteo returned an invalid daily forecast");
            }
            checkedTrips += 1;

            for (const [index, tripDate] of daily.time.entries()) {
                const day = {
                    weather_code: daily.weather_code?.[index],
                    temperature_2m_max: daily.temperature_2m_max?.[index],
                    temperature_2m_min: daily.temperature_2m_min?.[index],
                    precipitation_sum: daily.precipitation_sum?.[index],
                    precipitation_probability_max: daily.precipitation_probability_max?.[index],
                    wind_speed_10m_max: daily.wind_speed_10m_max?.[index],
                };
                const conditions = getWeatherConditions(day);
                const filter = { user: trip.user, dedupeKey: `${trip._id}:${tripDate}` };

                if (conditions.length === 0) {
                    await NotificationModel.updateOne(filter, { $set: { resolvedAt: new Date(now) } });
                    continue;
                }

                const conditionText = conditions.join(", ");
                const suggestions = getActivitySuggestions(conditions);
                const affectedActivities = getAffectedActivities(trip, tripDate);
                const measurements = [
                    Number.isFinite(toFiniteNumber(day.temperature_2m_max)) ? `high ${day.temperature_2m_max}°C` : null,
                    Number.isFinite(toFiniteNumber(day.precipitation_probability_max)) ? `${day.precipitation_probability_max}% rain chance` : null,
                    Number.isFinite(toFiniteNumber(day.wind_speed_10m_max)) ? `wind up to ${day.wind_speed_10m_max} km/h` : null,
                ].filter(Boolean);
                const message = `Forecast flags ${conditionText} for ${tripDate}${measurements.length ? ` (${measurements.join(", ")})` : ""}. Review your outdoor plans and consider an alternative.`;

                await NotificationModel.findOneAndUpdate(
                    filter,
                    {
                        $set: {
                            trip: trip._id,
                            destination: trip.destination,
                            tripDate,
                            title: `Weather update for ${trip.destination}`,
                            message,
                            conditions,
                            weather: {
                                temperatureMax: toOptionalFiniteNumber(day.temperature_2m_max),
                                temperatureMin: toOptionalFiniteNumber(day.temperature_2m_min),
                                precipitationProbability: toOptionalFiniteNumber(day.precipitation_probability_max),
                                precipitation: toOptionalFiniteNumber(day.precipitation_sum),
                                windSpeed: toOptionalFiniteNumber(day.wind_speed_10m_max),
                                weatherCode: toOptionalFiniteNumber(day.weather_code),
                            },
                            suggestions,
                            affectedActivities,
                            resolvedAt: null,
                        },
                        $setOnInsert: { read: false },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                );
                createdOrUpdatedAlerts += 1;
            }
        } catch (error) {
            console.error(`Weather check failed for trip ${trip._id}:`, error.message);
        }
    }

    return { checkedTrips, createdOrUpdatedAlerts };
};

module.exports = {
    checkTripWeather,
    getActivitySuggestions,
    getWeatherConditions,
    getTripWeatherForecast,
};
