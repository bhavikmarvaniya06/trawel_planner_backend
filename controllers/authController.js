const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const googleAuthService = require("../services/googleAuthService");

const otpStore = new Map();
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const generateOtp = () => String(crypto.randomInt(100000, 1000000));
const jwtSecret = process.env.JWT_SECRET || "tripai-dev-secret-key";

const getEmailFailureCategory = (error) => {
    if (error.code === "EMAIL_CONFIG_MISSING") return "configuration";
    if (error.code === "EAUTH") return "authentication";
    if (error.code === "EMAIL_RECIPIENT_REJECTED") return "rejected";
    if (["EDNS", "EAI_AGAIN", "ENOTFOUND"].includes(error.code)) return "dns";
    if (["ECONNECTION", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(error.code)) {
        return "network";
    }
    if (Number(error.responseCode) >= 500) return "provider";
    if (Number(error.responseCode) >= 400) return "rejected";
    return "unknown";
};

const logOtpEmailFailure = (error) => {
    console.error("OTP email delivery failed:", JSON.stringify({
        category: getEmailFailureCategory(error),
        code: typeof error.code === "string" ? error.code : "UNKNOWN",
        responseCode: Number.isFinite(Number(error.responseCode))
            ? Number(error.responseCode)
            : undefined,
        command: typeof error.command === "string" ? error.command : undefined,
    }));
};

const createEmailTransporter = () => {
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
        const error = new Error("Email service credentials are not configured.");
        error.code = "EMAIL_CONFIG_MISSING";
        throw error;
    }

    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: String(process.env.EMAIL_SECURE || "false") === "true",
        auth: {
            user: emailUser,
            pass: emailPass.replace(/\s+/g, ""),
        },
    });
};

const sendOtpEmail = async (toEmail, otp) => {
    const transporter = createEmailTransporter();

    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;

    const delivery = await transporter.sendMail({
        from: fromAddress,
        to: toEmail,
        subject: "Your TripAI OTP Login Code",
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
                <h2 style="margin-bottom: 12px;">TripAI OTP Login</h2>
                <p>Your one-time password is:</p>
                <div style="font-size: 32px; font-weight: 700; letter-spacing: 4px; margin: 18px 0; color: #0f172a;">${otp}</div>
                <p>This code will expire in 5 minutes.</p>
            </div>
        `,
    });

    if (delivery.rejected.includes(toEmail) || delivery.accepted.length === 0) {
        const error = new Error("SMTP server did not accept the OTP recipient.");
        error.code = "EMAIL_RECIPIENT_REJECTED";
        throw error;
    }
};

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
const requestOtpLogin = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Please provide your email address",
            });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "This email is not registered. Please sign up first.",
            });
        }

        if (user.role === "admin") {
            return res.status(403).json({
                success: false,
                message: "OTP login is only available for regular users.",
            });
        }

        const otp = generateOtp();

        try {
            await sendOtpEmail(email, otp);
        } catch (emailError) {
            logOtpEmailFailure(emailError);
            const message = emailError.code === "EAUTH"
                ? "The email provider rejected the sender credentials. For Gmail, use a valid App Password in EMAIL_PASS, with EMAIL_USER set to the same Gmail account. Restart the backend after updating backend/.env."
                : "We couldn't send the OTP email. Check the backend email configuration and provider logs, then try again.";

            return res.status(503).json({
                success: false,
                message,
            });
        }

        otpStore.set(email, {
            code: otp,
            expiresAt: Date.now() + OTP_TTL_MS,
            attempts: 0,
        });

        res.status(200).json({
            success: true,
            message: "OTP has been sent to your email address.",
        });
    } catch (error) {
        console.error("Request OTP failed:", JSON.stringify({
            name: typeof error.name === "string" ? error.name : "Error",
            code: typeof error.code === "string" ? error.code : "UNKNOWN",
        }));
        res.status(500).json({
            success: false,
            message: "Unable to send OTP right now.",
        });
    }
};

const verifyOtpLogin = async (req, res) => {
    try {
        const email = String(req.body.email || "").trim().toLowerCase();
        const otp = String(req.body.otp || "").trim();

        if (!email || !otp) {
            return res.status(400).json({
                success: false,
                message: "Please provide your email and OTP.",
            });
        }

        if (!/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                success: false,
                message: "OTP must be exactly 6 digits.",
            });
        }

        const storedOtp = otpStore.get(email);

        if (!storedOtp) {
            return res.status(400).json({
                success: false,
                message: "OTP expired or invalid. Please request a new one.",
            });
        }

        if (Date.now() >= storedOtp.expiresAt) {
            otpStore.delete(email);
            return res.status(400).json({
                success: false,
                message: "OTP expired. Please request a new code.",
            });
        }

        if (!crypto.timingSafeEqual(Buffer.from(storedOtp.code), Buffer.from(otp))) {
            storedOtp.attempts += 1;
            if (storedOtp.attempts >= MAX_OTP_ATTEMPTS) {
                otpStore.delete(email);
                return res.status(401).json({
                    success: false,
                    message: "Too many incorrect attempts. Please request a new OTP.",
                });
            }

            return res.status(401).json({
                success: false,
                message: "Incorrect OTP. Please try again.",
            });
        }

        otpStore.delete(email);
        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "This email is not registered.",
            });
        }

        if (user.role === "admin") {
            return res.status(403).json({
                success: false,
                message: "OTP login is only available for regular users.",
            });
        }

        const token = jwt.sign(
            {
                userId: user._id,
            },
            jwtSecret,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || "7d",
            }
        );

        res.status(200).json({
            success: true,
            message: "OTP login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
            },
        });
    } catch (error) {
        console.error("Verify OTP error:", error.message);
        res.status(500).json({
            success: false,
            message: "Unable to verify OTP.",
        });
    }
};

module.exports = {
    registerUser,
    loginUser,
    googleLogin,
    getMe,
    requestOtpLogin,
    verifyOtpLogin,
};