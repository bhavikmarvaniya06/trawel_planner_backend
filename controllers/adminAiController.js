const {
    handleAssistantChat,
    executePendingAction,
    fetchDashboardSummary,
    fetchStatistics,
} = require("../services/adminAiService");

const adminAssistantChat = async (req, res) => {
    try {
        const { message, history } = req.body;

        if (!message || typeof message !== "string" || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "A message is required for the AI Admin Assistant.",
            });
        }

        const result = await handleAssistantChat({
            message: message.trim(),
            history: Array.isArray(history) ? history : [],
        });

        res.status(200).json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error("AI Admin Assistant error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to process AI assistant request.",
        });
    }
};

const adminAssistantConfirmAction = async (req, res) => {
    try {
        const { actionId, confirmed = true } = req.body;

        if (!actionId) {
            return res.status(400).json({
                success: false,
                message: "actionId is required to confirm an action.",
            });
        }

        const result = await executePendingAction({
            actionId,
            confirmed: Boolean(confirmed),
        });

        res.status(200).json(result);
    } catch (error) {
        console.error("AI Admin Assistant Confirmation error:", error);
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to execute database action.",
        });
    }
};

module.exports = {
    adminAssistantChat,
    adminAssistantConfirmAction,
};

