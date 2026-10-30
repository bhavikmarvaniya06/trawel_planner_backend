const assert = require("node:assert/strict");
const { test } = require("node:test");
const { generateItinerary, generateTripSuggestions } = require("./itineraryService");

const withoutGeminiAndWikivoyage = async (run) => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    const originalFetch = global.fetch;
    delete process.env.GEMINI_API_KEY;
    global.fetch = async () => {
        throw new Error("Wikivoyage is unavailable");
    };

    try {
        await run();
    } finally {
        if (originalApiKey === undefined) {
            delete process.env.GEMINI_API_KEY;
        } else {
            process.env.GEMINI_API_KEY = originalApiKey;
        }
        global.fetch = originalFetch;
    }
};

test("uses curated Bali suggestions when Wikivoyage is unavailable", async () => {
    await withoutGeminiAndWikivoyage(async () => {
        const suggestions = await generateTripSuggestions({
            destination: "Bali",
            days: 3,
        });

        assert.equal(suggestions.source, "curated");
        assert.equal(suggestions.type, "places");
        assert.ok(suggestions.suggestions.some(({ name }) => name === "Ubud Monkey Forest"));
        assert.ok(suggestions.suggestions.every(({ mapsUrl }) => mapsUrl.includes("Bali")));
    });
});

test("generates a Bali guide itinerary using curated suggestions when Wikivoyage is unavailable", async () => {
    await withoutGeminiAndWikivoyage(async () => {
        const itinerary = await generateItinerary({
            destination: "Bali",
            startDate: new Date("2027-04-01T00:00:00.000Z"),
            endDate: new Date("2027-04-01T00:00:00.000Z"),
            places: [],
        });

        assert.equal(itinerary.length, 1);
        assert.match(itinerary[0].title, /Bali/);
        assert.ok(itinerary[0].activities.length > 0);
    });
});
