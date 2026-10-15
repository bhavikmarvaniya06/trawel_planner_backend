const dns = require("dns");
const path = require("path");

dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const connectDB = require("./config/db");
const { createAdmin } = require("./scripts/createAdmin");
const migrateAdminCollections = require("./scripts/migrateAdminCollections");

const authRoutes = require("./routes/authRoutes");
const aiRoutes = require("./routes/aiRoutes");
const tripRoutes = require("./routes/tripRoutes");
const contactRoutes = require("./routes/contactRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

const bootstrap = async () => {
    try {
        await connectDB();
        await migrateAdminCollections();
        await createAdmin();

        // ============================
        // Middleware
        // ============================

        app.use(cors());

        app.use(express.json());


        // ============================
        // Routes
        // ============================

        app.use("/api/auth", authRoutes);

        app.use("/api/ai", aiRoutes);

        app.use("/api/trips", tripRoutes);

        app.use("/api/contact", contactRoutes);

        app.use("/api/feedback", feedbackRoutes);

        app.use("/api/admin", adminRoutes);


        // ============================
        // Test Route
        // ============================

        app.get("/", (req, res) => {

            res.json({
                success: true,
                message: "TripAI Backend is running",
            });

        });


        // ============================
        // Server
        // ============================

        const PORT = process.env.PORT || 5001;

        app.listen(PORT, () => {

            console.log(`Server running on port ${PORT}`);

        });
    } catch (error) {
        console.error("Failed to bootstrap server:", error.message);
        process.exit(1);
    }
};

bootstrap();