const dns = require("dns");
const path = require("path");
const http = require("http");

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
const destinationRoutes = require("./routes/destinationRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const cron = require("node-cron");
const { checkTripWeather } = require("./services/weatherMonitor");
const recommendationRoutes = require("./routes/recommendationRoutes");
const { Server } = require("socket.io");
const configureTripSockets = require("./services/tripSocket");

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

        app.use("/api/destinations", destinationRoutes);

        app.use("/api/payments", paymentRoutes);

        app.use("/api/notifications", notificationRoutes);

        app.use("/api/recommendations", recommendationRoutes);

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
        const server = http.createServer(app);
        const io = new Server(server, {
            cors: { origin: true },
        });
        configureTripSockets(io);
        app.set("io", io);

        cron.schedule("0 */6 * * *", () => {
            checkTripWeather().catch((error) => {
                console.error("Scheduled weather check failed:", error.message);
            });
        });
        checkTripWeather().catch((error) => {
            console.error("Initial weather check failed:", error.message);
        });

        server.listen(PORT, () => {

            console.log(`Server running on port ${PORT}`);

        });
    } catch (error) {
        console.error("Failed to bootstrap server:", error.message);
        process.exit(1);
    }
};

bootstrap();