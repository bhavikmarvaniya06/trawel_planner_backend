const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const googleAuthService = require("../services/googleAuthService");

const jwtSecret = process.env.JWT_SECRET || "tripai-dev-secret-key";

const sendGoogleLoginResponse = (res, user) => {
    const token = jwt.sign(
        { userId: user._id },
        jwtSecret,
        { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    return res.status(200).json({
        success: true,
        message: "Google login successful",
        token,
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
    });
};


// ============================
// REGISTER
// ============================

const registerUser = async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = String(email || "").trim().toLowerCase();

        if (!name || !normalizedEmail || !password) {
            return res.status(400).json({
                success: false,
                message: "Please provide name, email and password",
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password must be at least 6 characters",
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "User already exists",
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
        });

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });

    } catch (error) {

        console.error("Register error:", error.message);

        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};


// ============================
// LOGIN
// ============================

const loginUser = async (req, res) => {
    try {

        const { email, password } = req.body;
        const normalizedEmail = String(email || "").trim().toLowerCase();

        // Check fields
        if (!normalizedEmail || !password) {
            return res.status(400).json({
                success: false,
                message: "Please provide email and password",
            });
        }


        // Find user
        const user = await User.findOne({ email: normalizedEmail });

        if (!user || !user.password) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }


        // Compare password
        const isPasswordCorrect = await bcrypt.compare(
            password,
            user.password
        );

        if (!isPasswordCorrect) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password",
            });
        }


        // Create JWT
        const token = jwt.sign(
            {
                userId: user._id,
            },
            jwtSecret,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || "7d",
            }
        );


        // Response
        res.status(200).json({
            success: true,
            message: "Login successful",

            token,

            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });

    } catch (error) {

        console.error("Login error:", error.message);

        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};
const googleLogin = async (req, res) => {
    const idToken = String(req.body?.idToken || "").trim();

    if (!idToken) {
        return res.status(400).json({
            success: false,
            message: "Please provide a Google credential.",
        });
    }

    if (!process.env.GOOGLE_CLIENT_ID?.trim()) {
        return res.status(503).json({
            success: false,
            message: "Google Sign-In is not configured on this backend. Set GOOGLE_CLIENT_ID in backend/.env (or the backend host environment) and restart the backend.",
        });
    }

    let claims;

    try {
        claims = await googleAuthService.verifyGoogleIdToken(idToken);
    } catch (error) {
        const networkFailure = [
            "EAI_AGAIN",
            "ECONNREFUSED",
            "ECONNRESET",
            "ENOTFOUND",
            "ETIMEDOUT",
        ].includes(error.code) || error.response?.status >= 500;

        if (networkFailure) {
            console.error("Google token verification service unavailable:", error.message);
            return res.status(503).json({
                success: false,
                message: "Google Sign-In is temporarily unavailable. Please try again.",
            });
        }

        return res.status(401).json({
            success: false,
            message: "Google credential could not be verified.",
        });
    }

    const email = typeof claims?.email === "string"
        ? claims.email.trim().toLowerCase()
        : "";
    const googleId = typeof claims?.sub === "string" ? claims.sub : "";
    const name = typeof claims?.name === "string" && claims.name.trim()
        ? claims.name.trim()
        : email.split("@")[0];

    if (!googleId || !email.includes("@") || claims?.email_verified !== true) {
        return res.status(401).json({
            success: false,
            message: "Google account must have a verified email address.",
        });
    }

    try {
        let user = await User.findOne({ googleId });

        if (!user) {
            user = await User.findOne({ email });

            if (user?.googleId && user.googleId !== googleId) {
                return res.status(409).json({
                    success: false,
                    message: "This email is linked to a different Google account.",
                });
            }

            if (user) {
                user.googleId = googleId;
                await user.save();
            } else {
                user = await User.create({
                    name,
                    email,
                    googleId,
                    profileImage: typeof claims?.picture === "string" &&
                        claims.picture.startsWith("https://")
                        ? claims.picture
                        : "",
                });
            }
        }

        return sendGoogleLoginResponse(res, user);
    } catch (error) {
        if (error.code === 11000) {
            try {
                let user = await User.findOne({ googleId });

                if (user) {
                    return sendGoogleLoginResponse(res, user);
                }

                user = await User.findOne({ email });

                if (user?.googleId && user.googleId !== googleId) {
                    return res.status(409).json({
                        success: false,
                        message: "This email is linked to a different Google account.",
                    });
                }

                if (user) {
                    user.googleId = googleId;
                    await user.save();
                    return sendGoogleLoginResponse(res, user);
                }
            } catch (lookupError) {
                console.error("Google login account lookup error:", lookupError.message);
            }
        }

        console.error("Google login error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Unable to complete Google login.",
        });
    }
};
const getMe = async (req, res) => {
    try {

        const user = await User.findById(req.userId)
            .select("-password");

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found",
            });
        }

        res.status(200).json({
            success: true,
            user,
        });

    } catch (error) {

        console.error("Get user error:", error.message);

        res.status(500).json({
            success: false,
            message: "Server error",
        });
    }
};
module.exports = {
    registerUser,
    loginUser,
    googleLogin,
    getMe,
};