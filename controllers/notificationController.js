const Notification = require("../models/Notification");

const getMyNotifications = async (req, res) => {
    try {
        const notifications = await Notification.find({
            user: req.userId,
            resolvedAt: null,
        }).sort({ createdAt: -1 }).limit(30).lean();
        const unreadCount = notifications.filter((notification) => !notification.read).length;

        return res.status(200).json({
            success: true,
            count: notifications.length,
            unreadCount,
            notifications,
        });
    } catch (error) {
        console.error("Get notifications error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to load notifications.",
        });
    }
};

const markNotificationRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.userId },
            { $set: { read: true } },
            { new: true }
        );
        if (!notification) {
            return res.status(404).json({
                success: false,
                message: "Notification not found.",
            });
        }
        return res.status(200).json({ success: true, notification });
    } catch (error) {
        console.error("Mark notification read error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to update notification.",
        });
    }
};

module.exports = { getMyNotifications, markNotificationRead };
