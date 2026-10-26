const isHttpUrl = (value) => {
    if (typeof value !== "string" || value.length > 2048) return false;
    if (!value.trim()) return true;

    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
};

const validateDestinationPayload = (payload, partial = false) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { error: "Destination details must be an object." };
    }

    const fields = [
        "name", "country", "region", "location", "description", "imageUrl",
        "currency", "price", "durationDays", "itinerary", "bookingDetails", "active",
    ];
    const data = Object.fromEntries(
        fields.filter((field) => payload[field] !== undefined).map((field) => [field, payload[field]])
    );

    if (!partial && (typeof data.name !== "string" || !data.name.trim())) {
        return { error: "A destination name is required." };
    }
    if (data.name !== undefined && (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 120)) {
        return { error: "Destination name must be between 1 and 120 characters." };
    }

    for (const [field, maxLength] of Object.entries({
        country: 100,
        region: 100,
        location: 200,
        description: 2000,
    })) {
        if (data[field] !== undefined &&
            (typeof data[field] !== "string" || data[field].length > maxLength)) {
            return { error: `${field} must be text no longer than ${maxLength} characters.` };
        }
    }

    if (data.imageUrl !== undefined && !isHttpUrl(data.imageUrl)) {
        return { error: "Image URL must be a valid HTTP or HTTPS URL." };
    }

    if (data.currency !== undefined &&
        (typeof data.currency !== "string" || !/^[A-Z]{3}$/i.test(data.currency.trim()))) {
        return { error: "Currency must be a valid three-letter currency code." };
    }
    if (data.currency !== undefined) data.currency = data.currency.trim().toUpperCase();

    if (data.price !== undefined &&
        (typeof data.price === "boolean" || !Number.isFinite(Number(data.price)) || Number(data.price) < 0)) {
        return { error: "Price must be a non-negative number." };
    }
    if (data.price !== undefined) data.price = Number(data.price);

    if (data.durationDays !== undefined &&
        (!Number.isInteger(Number(data.durationDays)) || Number(data.durationDays) < 1 || Number(data.durationDays) > 30)) {
        return { error: "Duration must be between 1 and 30 days." };
    }
    if (data.durationDays !== undefined) data.durationDays = Number(data.durationDays);

    if (data.active !== undefined && typeof data.active !== "boolean") {
        return { error: "Published status must be true or false." };
    }

    if (data.itinerary !== undefined) {
        if (!Array.isArray(data.itinerary) || data.itinerary.length > 30) {
            return { error: "Itinerary must contain no more than 30 days." };
        }
        if (data.durationDays !== undefined &&
            data.itinerary.some((entry) => Number(entry?.day) > data.durationDays)) {
            return { error: "Itinerary days cannot exceed the package duration." };
        }

        const seenDays = new Set();
        const normalizedItinerary = [];
        for (const [index, entry] of data.itinerary.entries()) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                return { error: `Itinerary day ${index + 1} must be an object.` };
            }
            const day = Number(entry.day ?? index + 1);
            if (!Number.isInteger(day) || day < 1 || day > 30 || seenDays.has(day)) {
                return { error: "Itinerary day numbers must be unique integers from 1 to 30." };
            }
            if (typeof entry.title !== "string" || !entry.title.trim() || entry.title.length > 180) {
                return { error: `Itinerary day ${day} needs a title of 1-180 characters.` };
            }
            const description = entry.description === undefined ? "" : entry.description;
            if (typeof description !== "string" || description.length > 1200) {
                return { error: `Itinerary day ${day} description must be at most 1200 characters.` };
            }
            const activities = entry.activities === undefined ? [] : entry.activities;
            if (!Array.isArray(activities) || activities.length > 20 ||
                activities.some((activity) => typeof activity !== "string" || activity.trim().length > 180)) {
                return { error: `Itinerary day ${day} activities must be up to 20 text items of at most 180 characters.` };
            }
            seenDays.add(day);
            normalizedItinerary.push({
                day,
                title: entry.title.trim(),
                description: description.trim(),
                activities: activities.map((activity) => activity.trim()).filter(Boolean),
            });
        }
        data.itinerary = normalizedItinerary.sort((left, right) => left.day - right.day);
    }

    if (data.bookingDetails !== undefined) {
        const details = data.bookingDetails;
        const contactEmail = typeof details?.contactEmail === "string"
            ? details.contactEmail.trim()
            : details?.contactEmail;
        if (!details || typeof details !== "object" || Array.isArray(details)) {
            return { error: "Booking details must be an object." };
        }
        const allowedBookingFields = ["available", "bookingUrl", "contactEmail", "contactPhone", "notes"];
        if (Object.keys(details).some((field) => !allowedBookingFields.includes(field))) {
            return { error: "Booking details contain an unsupported field." };
        }
        if (details.available !== undefined && typeof details.available !== "boolean") {
            return { error: "Booking availability must be true or false." };
        }
        if (details.bookingUrl !== undefined && !isHttpUrl(details.bookingUrl)) {
            return { error: "Booking URL must be a valid HTTP or HTTPS URL." };
        }
        if (contactEmail !== undefined &&
            (typeof contactEmail !== "string" ||
                (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) ||
                contactEmail.length > 254)) {
            return { error: "Booking contact email is invalid." };
        }
        if (details.contactPhone !== undefined &&
            (typeof details.contactPhone !== "string" || details.contactPhone.length > 40)) {
            return { error: "Booking contact phone must be at most 40 characters." };
        }
        if (details.notes !== undefined &&
            (typeof details.notes !== "string" || details.notes.length > 1000)) {
            return { error: "Booking notes must be at most 1000 characters." };
        }
        data.bookingDetails = {
            ...(details.available !== undefined ? { available: details.available } : {}),
            ...(details.bookingUrl !== undefined ? { bookingUrl: details.bookingUrl.trim() } : {}),
            ...(contactEmail !== undefined ? { contactEmail: contactEmail.toLowerCase() } : {}),
            ...(details.contactPhone !== undefined ? { contactPhone: details.contactPhone.trim() } : {}),
            ...(details.notes !== undefined ? { notes: details.notes.trim() } : {}),
        };
    }

    if (data.name !== undefined) data.name = data.name.trim();
    for (const field of ["country", "region", "location", "description", "imageUrl"]) {
        if (data[field] !== undefined) data[field] = data[field].trim();
    }

    return { data };
};

module.exports = { validateDestinationPayload };
