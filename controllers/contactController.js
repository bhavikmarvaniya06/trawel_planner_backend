const ContactQuery = require("../models/ContactQuery");

const createContactQuery = async (req, res) => {
    try {
        const { name, email, query } = req.body;

        if (!name || !email || !query) {
            return res.status(400).json({
                success: false,
                message: "Name, email, and query are required.",
            });
        }

        const contact = await ContactQuery.create({
            name: name.trim(),
            email: email.trim(),
            query: query.trim(),
        });

        res.status(201).json({
            success: true,
            message: "Your query has been received.",
            contact,
        });
    } catch (error) {
        console.error("Create contact query error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to submit your query right now.",
        });
    }
};

module.exports = {
    createContactQuery,
};
