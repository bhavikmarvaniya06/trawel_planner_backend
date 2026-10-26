const multer = require("multer");

const parseImages = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: 10,
        fileSize: 1024 * 1024,
        fields: 0,
    },
    fileFilter: (_req, file, callback) => {
        const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
        if (!allowedTypes.includes(file.mimetype)) {
            return callback(new Error("Only JPG, PNG, and WebP images are allowed."));
        }
        return callback(null, true);
    },
}).array("images", 10);

const destinationImageUpload = (req, res, next) => {
    parseImages(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === "LIMIT_FILE_SIZE";
        const tooMany = error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE";
        return res.status(tooLarge ? 413 : 400).json({
            success: false,
            message: tooLarge
                ? "Each destination image must be 1 MB or smaller."
                : tooMany
                    ? "Upload no more than 10 images per request."
                    : error.message,
        });
    });
};

module.exports = destinationImageUpload;
