const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const mongoose = require("mongoose");

const User = require("../models/User");

dotenv.config();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@tripai.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "TripAI@Admin2026";

const createAdmin = async () => {
    try {
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGO_URI);
        }

        const normalizedEmail = ADMIN_EMAIL.trim().toLowerCase();
        const password = await bcrypt.hash(ADMIN_PASSWORD, 10);
        const admin = await User.findOneAndUpdate(
            { email: normalizedEmail },
            {
                $set: {
                    name: "TripAI Admin",
                    email: normalizedEmail,
                    password,
                    role: "admin",
                },
            },
            {
                new: true,
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true,
            }
        );

        console.log(`Admin account ready: ${admin.email}`);
        return admin;
    } catch (error) {
        console.error("Unable to create admin account:", error.message);
        throw error;
    }
};

if (require.main === module) {
    createAdmin()
        .catch((error) => {
            process.exitCode = 1;
        })
        .finally(async () => {
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
        });
}

module.exports = {
    createAdmin,
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
};
