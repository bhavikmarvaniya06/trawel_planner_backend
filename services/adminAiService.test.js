const assert = require("node:assert/strict");
const { afterEach, beforeEach, test } = require("node:test");
const User = require("../models/User");
const Destination = require("../models/Destination");
const { handleAssistantChat } = require("./adminAiService");

const originalCountDocuments = User.countDocuments;
const originalDestinationCountDocuments = Destination.countDocuments;
let countQueries;

beforeEach(() => {
    countQueries = [];
    User.countDocuments = async (query) => {
        countQueries.push(query);
        return countQueries.length === 1 ? 3 : 17;
    };
});

afterEach(() => {
    User.countDocuments = originalCountDocuments;
    Destination.countDocuments = originalDestinationCountDocuments;
});

test("answers date-specific user counts from MongoDB using an explicit year", async () => {
    const response = await handleAssistantChat({
        message: "How many users registered on October 29, 2025?",
    });

    assert.equal(response.data.date, "2025-10-29");
    assert.equal(response.data.registeredThatDay, 3);
    assert.equal(response.data.registeredByThen, 17);
    assert.match(response.reply, /\*\*Registered on October 29, 2025 \(UTC\):\*\* 3/);
    assert.deepEqual(countQueries, [
        { createdAt: { $gte: new Date("2025-10-29T00:00:00.000Z"), $lt: new Date("2025-10-30T00:00:00.000Z") } },
        { createdAt: { $lt: new Date("2025-10-30T00:00:00.000Z") } },
    ]);
});

test("assumes the current UTC year for dates without a year", async () => {
    const currentYear = new Date().getUTCFullYear();
    const response = await handleAssistantChat({
        message: "How many users do I have on date 29 oct?",
    });

    assert.equal(response.data.date, `${currentYear}-10-29`);
    assert.equal(countQueries.length, 2);
});

test("answers Hindi date-count questions using the same database query", async () => {
    const response = await handleAssistantChat({
        message: "29 oct ko kitne users register hue?",
    });

    assert.equal(response.data.date, `${new Date().getUTCFullYear()}-10-29`);
    assert.equal(response.data.registeredThatDay, 3);
});

test("answers an undated user-count question without requiring an OpenAI key", async () => {
    User.countDocuments = async (query) => {
        countQueries.push(query);
        if (!query) return 20;
        return query.role === "user" ? 18 : 2;
    };

    const response = await handleAssistantChat({ message: "how many user" });

    assert.equal(response.provider, "built-in");
    assert.deepEqual(response.data, { totalAccounts: 20, regularUsers: 18, admins: 2 });
    assert.match(response.reply, /\*\*Total accounts:\*\* 20/);
    assert.equal(countQueries.length, 3);
});

test("answers a simple Hindi total-user question", async () => {
    User.countDocuments = async (query) => {
        countQueries.push(query);
        if (!query) return 20;
        return query.role === "user" ? 18 : 2;
    };

    const response = await handleAssistantChat({ message: "mere kitne users hai" });

    assert.equal(response.data.totalAccounts, 20);
});

test("answers destination counts from the database without requiring OpenAI", async () => {
    Destination.countDocuments = async (query) => {
        countQueries.push(query);
        if (query.active === true) return 4;
        if (query.active === false) return 2;
        return 6;
    };

    const response = await handleAssistantChat({ message: "how many destinations do I have?" });

    assert.deepEqual(response.data, {
        collection: "destinations",
        count: 6,
        status: null,
        date: null,
    });
    assert.equal(countQueries[0] && countQueries[0].active, undefined);
    assert.match(response.reply, /Destinations:\*\* 6/);
});

test("counts active destinations when the question includes a status", async () => {
    Destination.countDocuments = async (query) => {
        countQueries.push(query);
        return query.active ? 4 : 0;
    };

    const response = await handleAssistantChat({ message: "How many active destinations are there?" });

    assert.equal(response.data.count, 4);
    assert.deepEqual(countQueries, [{ active: true }]);
});

test("apologizes and suggests supported questions when the built-in assistant cannot answer", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
        const response = await handleAssistantChat({ message: "What is the weather today?" });

        assert.match(response.reply, /Sorry, I couldn't answer that from the available database data/);
        assert.match(response.reply, /How many users, destinations, trips/);
        assert.match(response.reply, /dashboard summary or trip statistics/);
    } finally {
        if (originalApiKey === undefined) {
            delete process.env.OPENAI_API_KEY;
        } else {
            process.env.OPENAI_API_KEY = originalApiKey;
        }
    }
});
