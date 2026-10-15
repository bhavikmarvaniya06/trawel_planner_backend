const User = require("../models/User");

const adminOnly = async (req, res, next) => {

    try {

        const user = await User.findById(req.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "User not found",
            });
        }

        if (user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Admin access required",
            });
        }

        next();

    } catch (error) {

        console.error(
            "Admin middleware error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};

module.exports = adminOnly;