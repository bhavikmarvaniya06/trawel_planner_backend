const Trip = require("../models/Trip");
const TripExpense = require("../models/TripExpense");
const TripItinerary = require("../models/TripItinerary");
const User = require("../models/User");
const {
    findAccessibleTrip,
    isTripOwner,
    emitTripUpdate,
} = require("../services/tripAccess");

const getTripInvitations = async (req, res) => {
    try {
        const trips = await Trip.find({
            collaborators: {
                $elemMatch: { user: req.userId, status: "invited" },
            },
        }).populate("user", "name email").lean();
        const invitations = trips.map((trip) => ({
            _id: trip._id,
            destination: trip.destination,
            startDate: trip.startDate,
            endDate: trip.endDate,
            owner: trip.user,
            invitedAt: trip.collaborators.find(
                (member) => String(member.user) === String(req.userId)
            )?.invitedAt,
        }));
        return res.status(200).json({ success: true, invitations });
    } catch (error) {
        console.error("Get trip invitations failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load trip invitations." });
    }
};

const inviteCollaborator = async (req, res) => {
    const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ success: false, message: "Enter a valid account email address." });
    }

    try {
        const trip = await Trip.findById(req.params.id);
        if (!trip) return res.status(404).json({ success: false, message: "Trip not found." });
        if (!isTripOwner(trip, req.userId)) {
            return res.status(403).json({ success: false, message: "Only the trip owner can invite collaborators." });
        }
        const invitedUser = await User.findOne({ email }).select("_id name email");
        if (!invitedUser) {
            return res.status(404).json({
                success: false,
                message: "No account uses that email yet. Ask them to register before inviting.",
            });
        }
        if (String(invitedUser._id) === String(req.userId)) {
            return res.status(400).json({ success: false, message: "You already own this trip." });
        }
        const existing = trip.collaborators.find(
            (member) => String(member.user) === String(invitedUser._id)
        );
        if (existing?.status === "accepted") {
            return res.status(409).json({ success: false, message: "That user already collaborates on this trip." });
        }
        if (existing) {
            return res.status(409).json({ success: false, message: "An invitation is already pending." });
        }

        trip.collaborators.push({
            user: invitedUser._id,
            role: "editor",
            status: "invited",
            invitedBy: req.userId,
        });
        await trip.save();
        emitTripUpdate(req, "trip:collaboration-updated", {
            tripId: String(trip._id),
            type: "invitation-sent",
            collaborator: { _id: invitedUser._id, name: invitedUser.name, email: invitedUser.email },
        });
        return res.status(201).json({
            success: true,
            message: `Invitation sent to ${invitedUser.email}.`,
            collaborator: { _id: invitedUser._id, name: invitedUser.name, email: invitedUser.email, status: "invited" },
        });
    } catch (error) {
        console.error("Invite collaborator failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to invite that collaborator." });
    }
};

const acceptInvitation = async (req, res) => {
    try {
        const trip = await Trip.findOneAndUpdate(
            {
                _id: req.params.id,
                collaborators: {
                    $elemMatch: { user: req.userId, status: "invited" },
                },
            },
            {
                $set: {
                    "collaborators.$.status": "accepted",
                    "collaborators.$.acceptedAt": new Date(),
                },
            },
            { new: true }
        ).populate("collaborators.user", "name email");
        if (!trip) {
            return res.status(404).json({ success: false, message: "Invitation not found or already accepted." });
        }
        emitTripUpdate(req, "trip:collaboration-updated", {
            tripId: String(trip._id),
            type: "invitation-accepted",
            collaborator: trip.collaborators.find((member) => String(member.user._id) === String(req.userId)),
        });
        return res.status(200).json({ success: true, trip });
    } catch (error) {
        console.error("Accept trip invitation failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to accept this invitation." });
    }
};

const updateTripItinerary = async (req, res) => {
    const itinerary = req.body.itinerary;
    if (!Array.isArray(itinerary) || itinerary.length > 30) {
        return res.status(400).json({ success: false, message: "An itinerary must contain no more than 30 days." });
    }

    const normalized = [];
    const usedDayNumbers = new Set();
    for (const [index, day] of itinerary.entries()) {
        if (!day || typeof day !== "object" || Array.isArray(day)) {
            return res.status(400).json({ success: false, message: `Itinerary day ${index + 1} is invalid.` });
        }
        const dayNumber = Number(day.day ?? index + 1);
        const title = typeof day.title === "string" ? day.title.trim() : "";
        const date = day.date === undefined || day.date === null || day.date === ""
            ? null
            : new Date(day.date);
        const estimatedCost = Number(day.estimatedCost ?? 0);
        if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > 30
            || usedDayNumbers.has(dayNumber)
            || !title || title.length > 180 || (date && !Number.isFinite(date.getTime()))
            || !Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > 100000000
            || !Array.isArray(day.activities) || day.activities.length > 30
            || (day.sources !== undefined && (!Array.isArray(day.sources) || day.sources.length > 10))) {
            return res.status(400).json({ success: false, message: `Itinerary day ${index + 1} contains invalid fields.` });
        }
        usedDayNumbers.add(dayNumber);

        const activities = [];
        for (const activity of day.activities) {
            if (typeof activity === "string") {
                const titleText = activity.trim();
                if (!titleText || titleText.length > 180) {
                    return res.status(400).json({ success: false, message: "Activity names must be 1 to 180 characters." });
                }
                activities.push(titleText);
                continue;
            }
            if (!activity || typeof activity !== "object" || Array.isArray(activity)
                || typeof activity.title !== "string" || !activity.title.trim() || activity.title.length > 180
                || ["time", "description", "location", "type"].some(
                    (key) => activity[key] !== undefined && (typeof activity[key] !== "string" || activity[key].length > 1000)
                )) {
                return res.status(400).json({ success: false, message: "An itinerary activity contains invalid fields." });
            }
            activities.push({
                title: activity.title.trim(),
                time: activity.time || "",
                description: activity.description || "",
                location: activity.location || "",
                type: activity.type || "",
            });
        }

        const sources = [];
        for (const source of day.sources || []) {
            if (!source || typeof source !== "object" || typeof source.name !== "string"
                || source.name.length > 120 || typeof source.url !== "string" || source.url.length > 2048) {
                return res.status(400).json({ success: false, message: "Itinerary sources must include a name and URL." });
            }
            let parsedSourceUrl;
            try {
                parsedSourceUrl = new URL(source.url);
            } catch {
                return res.status(400).json({ success: false, message: "Itinerary source URLs must be valid HTTP or HTTPS links." });
            }
            if (!["http:", "https:"].includes(parsedSourceUrl.protocol)) {
                return res.status(400).json({ success: false, message: "Itinerary source URLs must be valid HTTP or HTTPS links." });
            }
            sources.push({ name: source.name.trim(), url: parsedSourceUrl.toString() });
        }
        normalized.push({
            day: dayNumber,
            date,
            title,
            estimatedCost,
            activities,
            sources,
        });
    }

    try {
        const trip = await findAccessibleTrip(req.params.id, req.userId);
        if (!trip) return res.status(404).json({ success: false, message: "Trip not found or access denied." });
        normalized.forEach((day, index) => {
            if (!day.date) {
                day.date = new Date(new Date(trip.startDate).getTime() + index * 86400000);
            }
        });
        const tripStart = new Date(trip.startDate).toISOString().slice(0, 10);
        const tripEnd = new Date(trip.endDate).toISOString().slice(0, 10);
        if (normalized.some((day) => {
            const itineraryDate = day.date.toISOString().slice(0, 10);
            return itineraryDate < tripStart || itineraryDate > tripEnd;
        })) {
            return res.status(400).json({
                success: false,
                message: "Itinerary dates must fall within the trip date range.",
            });
        }

        await TripItinerary.deleteMany({ trip: trip._id });
        if (normalized.length) {
            await TripItinerary.insertMany(normalized.map((day) => ({
                trip: trip._id,
                day: day.day,
                date: day.date,
                title: day.title,
                activities: day.activities,
                estimatedCost: day.estimatedCost,
            })));
        }
        trip.itinerary = normalized;
        await trip.save();

        const payload = {
            tripId: String(trip._id),
            type: "itinerary-updated",
            itinerary: trip.itinerary,
            updatedBy: String(req.userId),
        };
        emitTripUpdate(req, "trip:itinerary-updated", payload);
        return res.status(200).json({ success: true, itinerary: trip.itinerary });
    } catch (error) {
        console.error("Collaborative itinerary update failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to update the itinerary." });
    }
};

const voteForDestination = async (req, res) => {
    const destination = typeof req.body.destination === "string" ? req.body.destination.trim() : "";
    if (!destination || destination.length > 120) {
        return res.status(400).json({ success: false, message: "Destination must be 1 to 120 characters." });
    }

    try {
        const trip = await findAccessibleTrip(req.params.id, req.userId);
        if (!trip) return res.status(404).json({ success: false, message: "Trip not found or access denied." });
        let candidate = trip.destinationVotes.find(
            (vote) => vote.destination.toLowerCase() === destination.toLowerCase()
        );
        if (!candidate) {
            candidate = trip.destinationVotes.create({ destination, voters: [] });
            trip.destinationVotes.push(candidate);
        }
        for (const vote of trip.destinationVotes) {
            vote.voters = vote.voters.filter((voter) => String(voter) !== String(req.userId));
        }
        candidate.voters.push(req.userId);
        await trip.save();

        const votes = trip.destinationVotes.map((vote) => ({
            destination: vote.destination,
            count: vote.voters.length,
            votedByMe: vote.voters.some((voter) => String(voter) === String(req.userId)),
        }));
        emitTripUpdate(req, "trip:vote-updated", {
            tripId: String(trip._id),
            type: "vote-updated",
            votes,
            updatedBy: String(req.userId),
        });
        return res.status(200).json({ success: true, votes });
    } catch (error) {
        console.error("Destination vote failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to save your destination vote." });
    }
};

const getTripExpenses = async (req, res) => {
    try {
        const trip = await findAccessibleTrip(req.params.id, req.userId);
        if (!trip) return res.status(404).json({ success: false, message: "Trip not found or access denied." });
        const expenses = await TripExpense.find({ trip: trip._id })
            .populate("paidBy", "name email")
            .populate("shares.user", "name")
            .sort({ date: -1 })
            .lean();
        return res.status(200).json({ success: true, expenses });
    } catch (error) {
        console.error("Get trip expenses failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load group expenses." });
    }
};

const addTripExpense = async (req, res) => {
    const category = typeof req.body.category === "string" ? req.body.category.trim() : "";
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    const amount = Number(req.body.amount);
    const date = req.body.date === undefined ? new Date() : new Date(req.body.date);
    if (!category || category.length > 80 || description.length > 500
        || !Number.isFinite(amount) || amount <= 0 || amount > 100000000
        || !Number.isFinite(date.getTime())) {
        return res.status(400).json({
            success: false,
            message: "Provide a valid category, amount, description, and date for the expense.",
        });
    }

    try {
        const trip = await findAccessibleTrip(req.params.id, req.userId);
        if (!trip) return res.status(404).json({ success: false, message: "Trip not found or access denied." });
        const memberIds = [
            trip.user,
            ...trip.collaborators
                .filter((member) => member.status === "accepted")
                .map((member) => member.user),
        ].map(String);
        const totalCents = Math.round(amount * 100);
        const centsPerMember = Math.floor(totalCents / memberIds.length);
        let assignedCents = 0;
        const shares = memberIds.map((memberId, index) => {
            const shareCents = index === memberIds.length - 1
                ? totalCents - assignedCents
                : centsPerMember;
            assignedCents += shareCents;
            return { user: memberId, amount: shareCents / 100 };
        });
        const expense = await TripExpense.create({
            trip: trip._id,
            category,
            description,
            amount,
            currency: trip.currency,
            date,
            paidBy: req.userId,
            shares,
        });
        const populatedExpense = await TripExpense.findById(expense._id)
            .populate("paidBy", "name email")
            .populate("shares.user", "name")
            .lean();
        emitTripUpdate(req, "trip:expense-added", {
            tripId: String(trip._id),
            type: "expense-added",
            expense: populatedExpense,
            updatedBy: String(req.userId),
        });
        return res.status(201).json({ success: true, expense: populatedExpense });
    } catch (error) {
        console.error("Create group expense failed:", error.message);
        return res.status(500).json({ success: false, message: "Unable to save this group expense." });
    }
};

module.exports = {
    getTripInvitations,
    inviteCollaborator,
    acceptInvitation,
    updateTripItinerary,
    voteForDestination,
    getTripExpenses,
    addTripExpense,
};
