const OpenAI = require("openai");
const User = require("../models/User");
const Trip = require("../models/Trip");
const Destination = require("../models/Destination");
const ContactQuery = require("../models/ContactQuery");
const Feedback = require("../models/Feedback");
const TripItinerary = require("../models/TripItinerary");
const TripExpense = require("../models/TripExpense");

// In-memory store for pending modification actions awaiting admin confirmation
const pendingActionsStore = new Map();
const ACTION_TTL_MS = 15 * 60 * 1000; // 15 minutes

const getOpenAIClient = () => {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;
    return new OpenAI({ apiKey });
};

// ==========================================
// DATA RETRIEVAL HELPERS
// ==========================================

const fetchDashboardSummary = async () => {
    const [userCount, tripCount, queryCount, feedbackCount, destinationCount, trips, expenses] = await Promise.all([
        User.countDocuments(),
        Trip.countDocuments(),
        ContactQuery.countDocuments(),
        Feedback.countDocuments(),
        Destination.countDocuments(),
        Trip.find().select("budget currency status destination").lean(),
        TripExpense.find().select("amount currency").lean(),
    ]);

    const currencyTotals = {};
    trips.forEach((t) => {
        const curr = t.currency || "USD";
        currencyTotals[curr] = currencyTotals[curr] || { budget: 0, expenses: 0 };
        currencyTotals[curr].budget += Number(t.budget) || 0;
    });

    expenses.forEach((e) => {
        const curr = e.currency || "USD";
        currencyTotals[curr] = currencyTotals[curr] || { budget: 0, expenses: 0 };
        currencyTotals[curr].expenses += Number(e.amount) || 0;
    });

    const activeDestinations = await Destination.countDocuments({ active: true });
    const openQueries = await ContactQuery.countDocuments({ status: "open" });

    return {
        totalUsers: userCount,
        totalTrips: tripCount,
        totalDestinations: destinationCount,
        activeDestinations,
        totalQueries: queryCount,
        openQueries,
        totalFeedback: feedbackCount,
        currencySummaries: currencyTotals,
    };
};

const fetchStatistics = async (category = "all") => {
    const stats = {};

    if (category === "trips" || category === "all") {
        const trips = await Trip.find().select("status travelStyle budget currency destination createdAt").lean();
        const byStatus = {};
        const byStyle = {};
        const topDestinations = {};

        trips.forEach((t) => {
            byStatus[t.status || "planned"] = (byStatus[t.status || "planned"] || 0) + 1;
            byStyle[t.travelStyle || "balanced"] = (byStyle[t.travelStyle || "balanced"] || 0) + 1;
            const dest = t.destination?.trim();
            if (dest) topDestinations[dest] = (topDestinations[dest] || 0) + 1;
        });

        stats.trips = {
            total: trips.length,
            byStatus,
            byStyle,
            topDestinations: Object.entries(topDestinations)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([name, count]) => ({ destination: name, tripCount: count })),
        };
    }

    if (category === "users" || category === "all") {
        const [total, adminCount, recentUsers] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: "admin" }),
            User.find().select("name email role createdAt").sort({ createdAt: -1 }).limit(5).lean(),
        ]);
        stats.users = {
            total,
            admins: adminCount,
            regularUsers: total - adminCount,
            recentUsers,
        };
    }

    if (category === "feedback" || category === "all") {
        const feedbackList = await Feedback.find().select("rating message page createdAt").lean();
        const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;
        feedbackList.forEach((f) => {
            const r = Math.round(Number(f.rating)) || 0;
            if (r >= 1 && r <= 5) ratingCounts[r] += 1;
            sum += Number(f.rating) || 0;
        });

        stats.feedback = {
            total: feedbackList.length,
            averageRating: feedbackList.length ? (sum / feedbackList.length).toFixed(2) : "0.00",
            ratingBreakdown: ratingCounts,
        };
    }

    if (category === "queries" || category === "all") {
        const queries = await ContactQuery.find().select("status createdAt").lean();
        const byStatus = { open: 0, in_progress: 0, resolved: 0 };
        queries.forEach((q) => {
            const st = q.status || "open";
            byStatus[st] = (byStatus[st] || 0) + 1;
        });
        stats.queries = {
            total: queries.length,
            byStatus,
        };
    }

    return stats;
};

const searchAllCollections = async (searchQuery, collectionFilter = "all", limit = 10) => {
    const rawLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const regex = new RegExp(String(searchQuery || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const results = {};

    const tasks = [];

    if (["all", "destinations"].includes(collectionFilter)) {
        tasks.push(
            Destination.find({
                $or: [{ name: regex }, { country: regex }, { region: regex }, { description: regex }],
            })
                .limit(rawLimit)
                .lean()
                .then((docs) => { results.destinations = docs; })
        );
    }

    if (["all", "trips"].includes(collectionFilter)) {
        tasks.push(
            Trip.find({
                $or: [{ destination: regex }, { travelStyle: regex }, { interests: regex }, { status: regex }],
            })
                .populate("user", "name email")
                .limit(rawLimit)
                .lean()
                .then((docs) => { results.trips = docs; })
        );
    }

    if (["all", "users"].includes(collectionFilter)) {
        tasks.push(
            User.find({
                $or: [{ name: regex }, { email: regex }, { role: regex }],
            })
                .select("-password")
                .limit(rawLimit)
                .lean()
                .then((docs) => { results.users = docs; })
        );
    }

    if (["all", "queries"].includes(collectionFilter)) {
        tasks.push(
            ContactQuery.find({
                $or: [{ name: regex }, { email: regex }, { query: regex }, { status: regex }],
            })
                .limit(rawLimit)
                .lean()
                .then((docs) => { results.queries = docs; })
        );
    }

    if (["all", "feedback"].includes(collectionFilter)) {
        tasks.push(
            Feedback.find({
                $or: [{ name: regex }, { email: regex }, { message: regex }, { page: regex }],
            })
                .limit(rawLimit)
                .lean()
                .then((docs) => { results.feedback = docs; })
        );
    }

    await Promise.all(tasks);
    return results;
};

const generateComprehensiveReport = async (reportType = "executive") => {
    const [summary, stats, destinations] = await Promise.all([
        fetchDashboardSummary(),
        fetchStatistics("all"),
        Destination.find().lean(),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        reportType,
        summary,
        stats,
        destinationsCount: destinations.length,
        destinationsActive: destinations.filter((d) => d.active).length,
    };
};

// ==========================================
// OPENAI TOOLS DEFINITIONS
// ==========================================

const assistantTools = [
    {
        type: "function",
        function: {
            name: "get_dashboard_summary",
            description: "Retrieve top-level platform overview metrics, counts of users, trips, destinations, customer queries, and feedback.",
            parameters: { type: "object", properties: {}, required: [] },
        },
    },
    {
        type: "function",
        function: {
            name: "get_statistics",
            description: "Get detailed statistics on trips (status, travel styles, top destinations), users, feedback ratings, or customer queries.",
            parameters: {
                type: "object",
                properties: {
                    category: {
                        type: "string",
                        enum: ["all", "trips", "users", "feedback", "queries"],
                        description: "Which domain of statistics to compute",
                    },
                },
                required: ["category"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_user_registration_counts",
            description: "Count users registered on a specific calendar date and the cumulative number registered by the end of that date. Use UTC dates and provide date as YYYY-MM-DD.",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "Date to check in YYYY-MM-DD format" },
                },
                required: ["date"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "count_records",
            description: "Count records in a TripAI database collection. Supports users, trips, destinations, feedback, contact queries, itineraries, and expenses. Optionally filter by an ISO date or a supported collection status. Use this for direct count questions.",
            parameters: {
                type: "object",
                properties: {
                    collection: {
                        type: "string",
                        enum: ["users", "trips", "destinations", "feedback", "queries", "itineraries", "expenses"],
                    },
                    date: { type: "string", description: "Optional date in YYYY-MM-DD format; counts records created on that UTC date" },
                    status: { type: "string", description: "Optional status/role filter supported by the selected collection" },
                },
                required: ["collection"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_records",
            description: "Search across users, trips, destinations, customer queries, or feedback by keyword or attribute.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query or keyword" },
                    collection: {
                        type: "string",
                        enum: ["all", "destinations", "trips", "users", "queries", "feedback"],
                        description: "Specific collection or 'all'",
                    },
                    limit: { type: "number", description: "Max results to return (default 10)" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_analytics_report",
            description: "Generate a formatted analytical report covering travel operations, platform growth, popular destinations, or queries.",
            parameters: {
                type: "object",
                properties: {
                    reportType: {
                        type: "string",
                        enum: ["executive", "financial", "destinations", "queries", "full"],
                        description: "Type of report to produce",
                    },
                },
                required: ["reportType"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "propose_destination_action",
            description: "Propose creating, updating, deleting, or activating/deactivating a featured destination. IMPORTANT: This does NOT modify the database directly. It prepares a pending action requiring explicit admin confirmation.",
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: ["create", "update", "delete", "toggle_active"],
                        description: "The intended database operation on destinations",
                    },
                    destinationId: { type: "string", description: "ID of the destination if updating, deleting, or toggling" },
                    name: { type: "string", description: "Name of the destination" },
                    country: { type: "string", description: "Country of the destination" },
                    region: { type: "string", description: "Region or state" },
                    description: { type: "string", description: "Short description of the destination" },
                    imageUrl: { type: "string", description: "Image URL for the destination" },
                    currency: { type: "string", description: "3-letter uppercase currency code (e.g. USD, EUR, INR)" },
                    active: { type: "boolean", description: "Whether the destination is active and visible to travelers" },
                },
                required: ["action", "name"],
            },
        },
    },
];

// Helper to create and record a pending action
const createPendingAction = (type, title, description, data, targetId = null, targetLabel = "") => {
    const actionId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const action = {
        actionId,
        type,
        title,
        description,
        data,
        targetId,
        targetLabel: targetLabel || data.name || "Destination",
        createdAt: Date.now(),
        expiresAt: Date.now() + ACTION_TTL_MS,
    };
    pendingActionsStore.set(actionId, action);
    return action;
};

// ==========================================
// BUILT-IN FALLBACK NATURAL LANGUAGE PROCESSOR
// (Activated if OpenAI key is omitted or quota exceeded)
// ==========================================

const parseUserCountDate = (message) => {
    const monthNames = {
        jan: 0, january: 0,
        feb: 1, february: 1,
        mar: 2, march: 2,
        apr: 3, april: 3,
        may: 4,
        jun: 5, june: 5,
        jul: 6, july: 6,
        aug: 7, august: 7,
        sep: 8, sept: 8, september: 8,
        oct: 9, october: 9,
        nov: 10, november: 10,
        dec: 11, december: 11,
    };
    const text = message.toLowerCase();
    const currentYear = new Date().getUTCFullYear();
    let year;
    let month;
    let day;
    let match = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);

    if (match) {
        year = Number(match[1]);
        month = Number(match[2]) - 1;
        day = Number(match[3]);
    } else {
        match = text.match(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d{2}))?\b/)
            || text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:,?\s+(20\d{2}))?\b/);

        if (match) {
            const monthFirst = /^[a-z]/.test(match[1]);
            const monthText = monthFirst ? match[1] : match[2];
            day = Number(monthFirst ? match[2] : match[1]);
            year = Number(match[3] || match[4] || currentYear);
            month = monthNames[monthText];
        }
    }

    if (month === undefined) return null;
    const start = new Date(Date.UTC(year, month, day));
    if (
        start.getUTCFullYear() !== year
        || start.getUTCMonth() !== month
        || start.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        start,
        end: new Date(Date.UTC(year, month, day + 1)),
        year,
    };
};

const answerUserCountQuestion = async (message) => {
    if (!/\b(users?|accounts?|registrations?|sign[\s-]?ups?)\b/i.test(message)
        || !/\b(how many|count|number|total|registered|signed up|sign[\s-]?ups?|kitne|kitni|ginti|hai|hain)\b/i.test(message)) {
        return null;
    }

    const date = parseUserCountDate(message);
    if (date) return getUserRegistrationCounts(date);

    const [totalAccounts, regularUsers, admins] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ role: "user" }),
        User.countDocuments({ role: "admin" }),
    ]);

    return {
        reply: `### User Count\n- **Total accounts:** ${totalAccounts}\n- **Regular users:** ${regularUsers}\n- **Admins:** ${admins}`,
        data: { totalAccounts, regularUsers, admins },
        provider: "built-in",
    };
};

const getUserRegistrationCounts = async (date) => {
    const [registeredThatDay, registeredByThen] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: date.start, $lt: date.end } }),
        User.countDocuments({ createdAt: { $lt: date.end } }),
    ]);
    const label = date.start.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
    });

    return {
        reply: `### User Registration Count\n- **Registered on ${label} (UTC):** ${registeredThatDay}\n- **Total registered by the end of ${label} (UTC):** ${registeredByThen}`,
        data: { date: date.start.toISOString().slice(0, 10), registeredThatDay, registeredByThen },
        provider: "built-in",
    };
};

const collectionCountModels = {
    users: User,
    trips: Trip,
    destinations: Destination,
    feedback: Feedback,
    queries: ContactQuery,
    itineraries: TripItinerary,
    expenses: TripExpense,
};

const collectionLabels = {
    users: "users",
    trips: "trips",
    destinations: "destinations",
    feedback: "feedback entries",
    queries: "customer queries",
    itineraries: "itinerary entries",
    expenses: "trip expenses",
};

const collectionStatusFilters = {
    users: { user: { role: "user" }, admin: { role: "admin" } },
    trips: Object.fromEntries(["planned", "booked", "completed", "cancelled"].map((status) => [status, { status }])),
    destinations: { active: { active: true }, inactive: { active: false } },
    queries: Object.fromEntries(["open", "in_progress", "resolved"].map((status) => [status, { status }])),
};

const getCollectionCount = async ({ collection, date = null, status = "" }) => {
    const Model = collectionCountModels[collection];
    if (!Model) {
        throw new Error("The requested database collection is not supported.");
    }

    const filter = {};
    const normalizedStatus = typeof status === "string" ? status.toLowerCase() : "";
    if (normalizedStatus) {
        const statusFilter = collectionStatusFilters[collection]?.[normalizedStatus];
        if (!statusFilter) {
            throw new Error(`Status "${status}" is not supported for ${collection}.`);
        }
        Object.assign(filter, statusFilter);
    }

    if (date) {
        const parsedDate = parseUserCountDate(date);
        if (!parsedDate || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new Error("Please provide a valid date in YYYY-MM-DD format.");
        }
        filter.createdAt = { $gte: parsedDate.start, $lt: parsedDate.end };
    }

    return Model.countDocuments(filter);
};

const answerRecordCountQuestion = async (message) => {
    const text = message.toLowerCase();
    if (!/\b(how many|count|number|total|kitne|kitni|ginti|hai|hain)\b/i.test(text)) {
        return null;
    }

    const collections = [
        { key: "users", terms: /\b(users?|accounts?|registrations?|sign[\s-]?ups?)\b/i },
        { key: "trips", terms: /\b(trips?|travel plans?)\b/i },
        { key: "destinations", terms: /\b(destinations?|places?)\b/i },
        { key: "feedback", terms: /\b(feedback|reviews?)\b/i },
        { key: "queries", terms: /\b(query|queries|inquiry|inquiries|enquiry|enquiries|contact messages|support tickets)\b/i },
        { key: "itineraries", terms: /\b(itineraries|itinerary entries)\b/i },
        { key: "expenses", terms: /\b(expenses|trip expenses)\b/i },
    ];
    const collection = collections.find(({ terms }) => terms.test(text));
    if (!collection) return null;

    const date = parseUserCountDate(message);
    const statusTerms = ["planned", "booked", "completed", "cancelled", "open", "in_progress", "resolved", "active", "inactive", "admin"];
    const status = statusTerms.find((item) => new RegExp(`\\b${item}\\b`, "i").test(text)) || "";
    const count = await getCollectionCount({
        collection: collection.key,
        date: date ? date.start.toISOString().slice(0, 10) : null,
        status,
    });
    const dateLabel = date
        ? ` on ${date.start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} (UTC)`
        : "";
    const statusLabel = status ? ` with status **${status}**` : "";

    return {
        reply: `### Database Count\n- **${collectionLabels[collection.key].replace(/^./, (letter) => letter.toUpperCase())}${statusLabel}${dateLabel}:** ${count}`,
        data: { collection: collection.key, count, status: status || null, date: date?.start.toISOString().slice(0, 10) || null },
        provider: "built-in",
    };
};

const processWithBuiltinAssistant = async (message) => {
    const rawText = message.trim();
    const text = rawText.toLowerCase();

    const datedUserCount = await answerUserCountQuestion(rawText);
    if (datedUserCount) return datedUserCount;
    const recordCount = await answerRecordCountQuestion(rawText);
    if (recordCount) return recordCount;

    // 1. Propose Create Destination
    const addMatch = rawText.match(/(?:add|create|new)\s+destination\s+[:"']?([^"',\n]+)["']?(?:,\s*([^,\n]+))?/i)
        || rawText.match(/add\s+([^,]+),\s*([^,\s]+)\s+as\s+(?:a\s+)?destination/i);
    if (addMatch) {
        const name = (addMatch[1] || "").trim();
        const country = (addMatch[2] || "").trim();
        const pending = createPendingAction(
            "create_destination",
            `Create Destination: ${name}`,
            `Add "${name}"${country ? ` in ${country}` : ""} to the featured destination catalog.`,
            { name, country, region: "", description: `Explore ${name}.`, imageUrl: "", currency: "USD", active: true },
            null,
            name
        );
        return {
            reply: `I have prepared a proposal to add **${name}**${country ? ` (${country})` : ""} as a featured destination.\n\n⚠️ **Database Modification Notice**: This action has **not** been applied yet. Please review the details below and click **Confirm & Execute** to commit it to the database.`,
            pendingAction: pending,
            provider: "built-in",
        };
    }

    // 2. Propose Delete Destination
    const delMatch = rawText.match(/(?:delete|remove)\s+destination\s+[:"']?([^"',\n]+)["']?/i);
    if (delMatch) {
        const targetName = delMatch[1].trim();
        const found = await Destination.findOne({ name: new RegExp(`^${targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
        if (!found) {
            return {
                reply: `I couldn't find an existing destination matching "${targetName}". You can view all current destinations by asking "show destinations" or checking the Destinations tab.`,
                provider: "built-in",
            };
        }
        const pending = createPendingAction(
            "delete_destination",
            `Delete Destination: ${found.name}`,
            `Permanently remove "${found.name}" from the destinations catalog.`,
            { name: found.name },
            found._id.toString(),
            found.name
        );
        return {
            reply: `I found the destination **${found.name}** (${found.country || "No country specified"}).\n\n⚠️ **Deletion Confirmation Required**: Please confirm that you want to permanently delete this destination.`,
            pendingAction: pending,
            provider: "built-in",
        };
    }

    // 3. Propose Toggle/Deactivate/Activate
    const toggleMatch = rawText.match(/(?:deactivate|disable|activate|enable)\s+destination\s+[:"']?([^"',\n]+)["']?/i);
    if (toggleMatch) {
        const targetName = toggleMatch[1].trim();
        const shouldActivate = /activate|enable/i.test(text);
        const found = await Destination.findOne({ name: new RegExp(`^${targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
        if (!found) {
            return {
                reply: `Destination "${targetName}" not found.`,
                provider: "built-in",
            };
        }
        const pending = createPendingAction(
            "update_destination",
            `${shouldActivate ? "Activate" : "Deactivate"} Destination: ${found.name}`,
            `Change visibility of "${found.name}" to ${shouldActivate ? "Active" : "Inactive"}.`,
            { name: found.name, active: shouldActivate },
            found._id.toString(),
            found.name
        );
        return {
            reply: `I have prepared the change to set **${found.name}** to **${shouldActivate ? "Active" : "Inactive"}**.\n\n⚠️ **Confirmation Required**: Click **Confirm & Execute** below to save this change.`,
            pendingAction: pending,
            provider: "built-in",
        };
    }

    // 4. Dashboard Summary / Overview
    if (/summary|overview|dashboard|totals|metrics|kpi/i.test(text)) {
        const summary = await fetchDashboardSummary();
        const reply = [
            `### 📊 Travel Operations Dashboard Summary`,
            `- **Total Users**: ${summary.totalUsers} registered accounts`,
            `- **Total Trips**: ${summary.totalTrips} planned or booked`,
            `- **Featured Destinations**: ${summary.totalDestinations} (${summary.activeDestinations} active)`,
            `- **Customer Queries**: ${summary.totalQueries} total (${summary.openQueries} awaiting response)`,
            `- **Feedback Submissions**: ${summary.totalFeedback} reviews recorded`,
            ``,
            `**Financial Commitments (by currency):**`,
            ...Object.entries(summary.currencySummaries).map(
                ([curr, val]) => `• **${curr}**: Total Budgeted: ${val.budget.toLocaleString()} | Logged Expenses: ${val.expenses.toLocaleString()}`
            ),
        ].join("\n");
        return { reply, data: summary, provider: "built-in" };
    }

    // 5. Statistics
    if (/statistic|stat|breakdown|analytics|trends/i.test(text)) {
        const stats = await fetchStatistics("all");
        const topDests = stats.trips?.topDestinations || [];
        const reply = [
            `### 📈 Platform & Trip Statistics`,
            `**Trip Status Breakdown:**`,
            ...Object.entries(stats.trips?.byStatus || {}).map(([status, count]) => `• ${status.toUpperCase()}: ${count}`),
            ``,
            `**Popular Travel Styles:**`,
            ...Object.entries(stats.trips?.byStyle || {}).map(([style, count]) => `• ${style}: ${count} trips`),
            ``,
            `**Top Destination Demand:**`,
            ...(topDests.length ? topDests.map((d, i) => `${i + 1}. **${d.destination}** (${d.tripCount} trips planned)`) : ["• No trips recorded yet."]),
            ``,
            `**Feedback & Satisfaction:**`,
            `• Average Rating: **${stats.feedback?.averageRating || "N/A"} / 5.0** (${stats.feedback?.total || 0} reviews)`,
        ].join("\n");
        return { reply, data: stats, provider: "built-in" };
    }

    // 6. Search Records
    if (/search|find|lookup|show|filter/i.test(text)) {
        const queryTerm = text.replace(/^(?:search|find|lookup|show|filter)\s+(?:for\s+)?(?:records?\s+)?/i, "").trim();
        if (queryTerm) {
            const results = await searchAllCollections(queryTerm, "all", 8);
            const totalMatches = Object.values(results).reduce((sum, arr) => sum + (arr?.length || 0), 0);
            const lines = [`### 🔍 Search Results for "${queryTerm}" (${totalMatches} matches found)`];

            if (results.destinations?.length) {
                lines.push(`\n**Destinations (${results.destinations.length}):**`);
                results.destinations.forEach((d) => lines.push(`• **${d.name}** (${d.country || "No country"}) - ${d.active ? "Active" : "Inactive"}`));
            }
            if (results.trips?.length) {
                lines.push(`\n**Trips (${results.trips.length}):**`);
                results.trips.forEach((t) => lines.push(`• **${t.destination}** (Traveler: ${t.user?.name || "User"}, Status: ${t.status}, Budget: ${t.currency || "USD"} ${t.budget})`));
            }
            if (results.users?.length) {
                lines.push(`\n**Users (${results.users.length}):**`);
                results.users.forEach((u) => lines.push(`• **${u.name}** (${u.email}) - Role: ${u.role}`));
            }
            if (results.queries?.length) {
                lines.push(`\n**Customer Queries (${results.queries.length}):**`);
                results.queries.forEach((q) => lines.push(`• From: ${q.name} (${q.email}) [${q.status}]: "${q.query.slice(0, 70)}..."`));
            }
            if (results.feedback?.length) {
                lines.push(`\n**Feedback (${results.feedback.length}):**`);
                results.feedback.forEach((f) => lines.push(`• Rating: ${f.rating}★ by ${f.name}: "${f.message.slice(0, 70)}..."`));
            }

            if (totalMatches === 0) {
                lines.push(`No records matched "${queryTerm}". Try searching for a destination name, traveler email, status, or keyword.`);
            }

            return { reply: lines.join("\n"), data: results, provider: "built-in" };
        }
    }

    // 7. Generate Report
    if (/report/i.test(text)) {
        const report = await generateComprehensiveReport("executive");
        const reply = [
            `### 📑 Executive Travel Operations Report`,
            `*Generated: ${new Date(report.generatedAt).toLocaleString()}*`,
            ``,
            `#### 1. Operations Health`,
            `- **Platform Users**: ${report.summary.totalUsers} registered users`,
            `- **Trips Managed**: ${report.summary.totalTrips} planned or booked`,
            `- **Destinations Managed**: ${report.destinationsCount} (${report.destinationsActive} active)`,
            `- **Support Load**: ${report.summary.openQueries} unresolved inquiries`,
            ``,
            `#### 2. Customer Satisfaction`,
            `- **Average Score**: ${report.stats.feedback.averageRating} / 5.0 stars`,
            `- **5-Star Reviews**: ${report.stats.feedback.ratingBreakdown[5] || 0}`,
            `- **1-Star Reviews**: ${report.stats.feedback.ratingBreakdown[1] || 0}`,
            ``,
            `#### 3. Strategic Recommendations`,
            `- Keep featured destinations fresh with high-quality images and descriptions.`,
            `- Prioritize resolution of the ${report.summary.openQueries} open customer queries to maintain high user trust.`,
        ].join("\n");
        return { reply, data: report, provider: "built-in" };
    }

    // Default general response
    return {
        reply: "Sorry, I couldn't answer that from the available database data. Try asking:\n- How many users, destinations, trips, feedback entries, or contact queries do we have?\n- How many active destinations or open queries are there?\n- Show the dashboard summary or trip statistics.\n- Search for a destination, user, trip, or customer query.\n\nFor other natural-language questions, configure OPENAI_API_KEY in backend/.env and restart the backend.",
        provider: "built-in",
    };
};

// ==========================================
// MAIN ASSISTANT CHAT HANDLER
// ==========================================

const handleAssistantChat = async ({ message, history = [] }) => {
    if (!message || typeof message !== "string" || !message.trim()) {
        const err = new Error("Please provide a prompt or question.");
        err.statusCode = 400;
        throw err;
    }

    const datedUserCount = await answerUserCountQuestion(message);
    if (datedUserCount) return datedUserCount;
    const recordCount = await answerRecordCountQuestion(message);
    if (recordCount) return recordCount;

    const openai = getOpenAIClient();

    // If no OpenAI API key is set, use the built-in natural language engine
    if (!openai) {
        return processWithBuiltinAssistant(message);
    }

    try {
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

        // Formulate messages
        const systemPrompt = `You are the conversational AI assistant for the TripAI platform administrator.
Answer the administrator's actual message directly. Understand natural phrasing, follow-up questions, and English or Hindi. Use the database tools whenever a question asks for platform facts; use count_records for counts of users, trips, destinations, feedback, contact queries, itineraries, or expenses. Never guess, invent, or imply you queried data you did not retrieve. Use only the fields and records returned by the tools. If a request is ambiguous or the data needed is unavailable, apologize, explain what is unsupported or missing, and suggest example questions about users, destinations, trips, feedback, customer queries, dashboard summaries, and trip statistics. Keep the answer concise and in the language used by the administrator.

Use the narrowest suitable data tool and only request records needed for the question. For date-based user counts, use get_user_registration_counts with a YYYY-MM-DD date. Current UTC date is ${new Date().toISOString().slice(0, 10)}; if a year is omitted, assume the current UTC year.

SECURITY AND INTEGRITY:
- Never expose passwords, secrets, tokens, or other credentials.
- For any request to create, update, or delete a destination, call propose_destination_action. Never claim the change is complete; it must be confirmed by the administrator.
- Never perform or claim any other database write.`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...history
                .filter((h) => h && (h.sender === "user" || h.sender === "assistant") && typeof h.text === "string")
                .slice(-8)
                .map((h) => ({ role: h.sender, content: h.text.slice(0, 4000) })),
            { role: "user", content: message },
        ];

        let pendingAction = null;
        const toolData = [];

        const executeTool = async (toolCall) => {
            const name = toolCall.function?.name;
            let args;
            try {
                args = JSON.parse(toolCall.function?.arguments || "{}");
            } catch {
                throw new Error(`The AI returned invalid arguments for ${name || "a database tool"}.`);
            }

            let result;
            let data;
            let proposedAction = null;

            if (name === "get_dashboard_summary") {
                result = await fetchDashboardSummary();
                data = result;
            } else if (name === "get_statistics") {
                const category = ["all", "trips", "users", "feedback", "queries"].includes(args.category)
                    ? args.category
                    : "all";
                result = await fetchStatistics(category);
                data = result;
            } else if (name === "get_user_registration_counts") {
                const date = parseUserCountDate(args.date || "");
                if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(args.date || "")) {
                    throw new Error("The AI requested an invalid registration date.");
                }
                result = await getUserRegistrationCounts(date);
                data = result.data;
            } else if (name === "count_records") {
                const collection = Object.prototype.hasOwnProperty.call(collectionCountModels, args.collection)
                    ? args.collection
                    : null;
                if (!collection) {
                    throw new Error("The AI requested a count for an unsupported database collection.");
                }
                const count = await getCollectionCount({
                    collection,
                    date: args.date || null,
                    status: args.status || "",
                });
                result = {
                    collection,
                    count,
                    status: args.status || null,
                    date: args.date || null,
                };
                data = result;
            } else if (name === "search_records") {
                if (typeof args.query !== "string" || !args.query.trim()) {
                    throw new Error("The AI requested a record search without a search term.");
                }
                const collection = ["all", "destinations", "trips", "users", "queries", "feedback"].includes(args.collection)
                    ? args.collection
                    : "all";
                result = await searchAllCollections(args.query, collection, args.limit || 10);
                data = result;
            } else if (name === "generate_analytics_report") {
                const reportType = ["executive", "financial", "destinations", "queries", "full"].includes(args.reportType)
                    ? args.reportType
                    : "executive";
                result = await generateComprehensiveReport(reportType);
                data = result;
            } else if (name === "propose_destination_action") {
                if (pendingAction) {
                    return {
                        result: {
                            status: "NOT_PROPOSED",
                            message: "Only one destination change can be proposed in a single assistant reply. Ask the administrator to submit changes one at a time.",
                        },
                    };
                }
                if (typeof args.name !== "string" || !args.name.trim()) {
                    throw new Error("A destination name is required before a change can be proposed.");
                }
                if (!["create", "update", "delete", "toggle_active"].includes(args.action)) {
                    throw new Error("The requested destination action is not supported.");
                }

                const actionType = args.action; // 'create' | 'update' | 'delete' | 'toggle_active'
                let actionTypeMapped = "create_destination";
                let actionTitle = `Create Destination: ${args.name}`;
                let actionDesc = `Add "${args.name}"${args.country ? ` in ${args.country}` : ""} as a featured destination.`;

                let targetId = args.destinationId || null;
                if (!targetId && ["update", "delete", "toggle_active"].includes(actionType)) {
                    const match = await Destination.findOne({ name: new RegExp(`^${args.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
                    if (match) targetId = match._id.toString();
                }

                if (actionType === "delete") {
                    actionTypeMapped = "delete_destination";
                    actionTitle = `Delete Destination: ${args.name}`;
                    actionDesc = `Permanently delete "${args.name}" from the featured destination catalog.`;
                } else if (actionType === "update") {
                    actionTypeMapped = "update_destination";
                    actionTitle = `Update Destination: ${args.name}`;
                    actionDesc = `Modify properties of "${args.name}".`;
                } else if (actionType === "toggle_active") {
                    actionTypeMapped = "update_destination";
                    const willBeActive = args.active !== undefined ? Boolean(args.active) : false;
                    actionTitle = `${willBeActive ? "Activate" : "Deactivate"} Destination: ${args.name}`;
                    actionDesc = `Set visibility of "${args.name}" to ${willBeActive ? "Active" : "Inactive"}.`;
                }

                pendingAction = createPendingAction(
                    actionTypeMapped,
                    actionTitle,
                    actionDesc,
                    {
                        name: args.name,
                        country: args.country || "",
                        region: args.region || "",
                        description: args.description || "",
                        imageUrl: args.imageUrl || "",
                        currency: (args.currency || "USD").toUpperCase(),
                        active: args.active !== undefined ? Boolean(args.active) : true,
                    },
                    targetId,
                    args.name
                );

                proposedAction = pendingAction;
                result = {
                    status: "PENDING_CONFIRMATION",
                    actionId: pendingAction.actionId,
                    actionType: pendingAction.type,
                    title: pendingAction.title,
                    description: pendingAction.description,
                    message: "Database action has been staged. Awaiting explicit administrator confirmation before applying.",
                };
            } else {
                throw new Error(`The AI requested an unsupported database tool: ${name || "unknown"}.`);
            }

            if (data !== undefined) toolData.push(data);
            return { result, pendingAction: proposedAction };
        };

        for (let turn = 0; turn < 4; turn += 1) {
            const completion = await openai.chat.completions.create({
                model,
                messages,
                tools: assistantTools,
                tool_choice: "auto",
                temperature: 0.2,
            });
            const choice = completion.choices[0];
            if (!choice?.message) {
                throw new Error("The AI returned an empty response.");
            }

            const toolCalls = choice.message.tool_calls || [];
            if (toolCalls.length === 0) {
                if (typeof choice.message.content !== "string" || !choice.message.content.trim()) {
                    throw new Error("The AI returned an empty response.");
                }
                return {
                    reply: choice.message.content,
                    pendingAction,
                    data: toolData.length === 1 ? toolData[0] : toolData.length ? toolData : null,
                    provider: "openai",
                };
            }

            messages.push(choice.message);
            for (const toolCall of toolCalls) {
                if (!toolCall.id) {
                    throw new Error("The AI returned a database tool call without an identifier.");
                }
                const { result } = await executeTool(toolCall);
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: JSON.stringify(result),
                });
            }
        }

        throw new Error("The assistant could not finish answering this request. Please try a more specific question.");
    } catch (assistantError) {
        console.error("AI Admin Assistant request failed:", assistantError.message);
        if (pendingAction?.actionId) pendingActionsStore.delete(pendingAction.actionId);
        if (assistantError.statusCode) throw assistantError;
        const error = new Error(assistantError.status
            ? "The AI service is temporarily unavailable or its API key/quota needs attention. Please try again later."
            : assistantError.message || "Failed to process the AI assistant request.");
        error.statusCode = assistantError.status === 429 ? 503 : assistantError.status ? 502 : 500;
        throw error;
    }
};

// ==========================================
// CONFIRM AND EXECUTE PENDING ACTION
// ==========================================

const executePendingAction = async ({ actionId, confirmed = true }) => {
    if (!actionId) {
        const err = new Error("Action ID is required.");
        err.statusCode = 400;
        throw err;
    }

    const action = pendingActionsStore.get(actionId);
    if (!action) {
        const err = new Error("This action proposal has expired or already been processed. Please re-issue your request.");
        err.statusCode = 404;
        throw err;
    }

    if (Date.now() > action.expiresAt) {
        pendingActionsStore.delete(actionId);
        const err = new Error("This action proposal has timed out. Please request it again.");
        err.statusCode = 400;
        throw err;
    }

    // Always remove from store after resolution
    pendingActionsStore.delete(actionId);

    if (!confirmed) {
        return {
            success: true,
            cancelled: true,
            message: `Cancelled action: ${action.title}. No changes were made to the database.`,
        };
    }

    // Execute the database modification
    if (action.type === "create_destination") {
        const payload = action.data;
        if (!payload.name || !payload.name.trim()) {
            const err = new Error("Destination name is required.");
            err.statusCode = 400;
            throw err;
        }

        const duplicate = await Destination.findOne({
            name: new RegExp(`^${payload.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        });

        if (duplicate) {
            const err = new Error(`A destination named "${payload.name.trim()}" already exists.`);
            err.statusCode = 409;
            throw err;
        }

        const created = await Destination.create({
            name: payload.name.trim(),
            country: typeof payload.country === "string" ? payload.country.trim() : "",
            region: typeof payload.region === "string" ? payload.region.trim() : "",
            description: typeof payload.description === "string" ? payload.description.trim() : "",
            imageUrl: typeof payload.imageUrl === "string" ? payload.imageUrl.trim() : "",
            currency: (payload.currency || "USD").toUpperCase(),
            active: payload.active !== undefined ? Boolean(payload.active) : true,
        });

        return {
            success: true,
            action: action.type,
            message: `Destination "${created.name}" created successfully in the database.`,
            record: created,
        };
    }

    if (action.type === "update_destination") {
        let destination = null;
        if (action.targetId) {
            destination = await Destination.findById(action.targetId);
        }
        if (!destination && action.data?.name) {
            destination = await Destination.findOne({
                name: new RegExp(`^${action.data.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
            });
        }

        if (!destination) {
            const err = new Error("Destination record could not be found to update.");
            err.statusCode = 404;
            throw err;
        }

        const updates = action.data || {};
        ["country", "region", "description", "imageUrl", "currency"].forEach((key) => {
            if (updates[key] !== undefined) destination[key] = updates[key];
        });
        if (updates.active !== undefined) destination.active = Boolean(updates.active);
        if (updates.name && updates.name.trim()) destination.name = updates.name.trim();

        await destination.save();

        return {
            success: true,
            action: action.type,
            message: `Destination "${destination.name}" updated successfully.`,
            record: destination,
        };
    }

    if (action.type === "delete_destination") {
        let destination = null;
        if (action.targetId) {
            destination = await Destination.findByIdAndDelete(action.targetId);
        }
        if (!destination && action.data?.name) {
            destination = await Destination.findOneAndDelete({
                name: new RegExp(`^${action.data.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
            });
        }

        if (!destination) {
            const err = new Error("Destination record to delete was not found.");
            err.statusCode = 404;
            throw err;
        }

        return {
            success: true,
            action: action.type,
            message: `Destination "${destination.name}" deleted successfully.`,
            record: { _id: destination._id, name: destination.name },
        };
    }

    const err = new Error(`Unsupported modification action: ${action.type}`);
    err.statusCode = 400;
    throw err;
};

module.exports = {
    handleAssistantChat,
    executePendingAction,
    fetchDashboardSummary,
    fetchStatistics,
    searchAllCollections,
    generateComprehensiveReport,
};
