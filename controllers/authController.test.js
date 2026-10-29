const assert = require("node:assert/strict");
const { test } = require("node:test");
const nodemailer = require("nodemailer");
const User = require("../models/User");
const { requestOtpLogin, verifyOtpLogin } = require("./authController");

const originalFindOne = User.findOne;
const originalCreateTransport = nodemailer.createTransport;
const originalEmailUser = process.env.EMAIL_USER;
const originalEmailPass = process.env.EMAIL_PASS;

const makeResponse = () => ({
    statusCode: null,
    body: null,
    status(statusCode) {
        this.statusCode = statusCode;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test("OTP email configuration failures log only safe diagnostics", async () => {
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_PASS;
    User.findOne = async () => ({ role: "user" });
    const originalConsoleError = console.error;
    const logLines = [];
    console.error = (...values) => logLines.push(values.join(" "));

    try {
        const response = makeResponse();
        await requestOtpLogin({ body: { email: "traveler@example.com" } }, response);

        assert.equal(response.statusCode, 503);
        assert.match(response.body.message, /backend email configuration/i);
        assert.match(logLines.join("\n"), /"category":"configuration"/);
        assert.doesNotMatch(logLines.join("\n"), /traveler@example\.com|EMAIL_PASS|[0-9]{6}/);
    } finally {
        User.findOne = originalFindOne;
        console.error = originalConsoleError;

        if (originalEmailUser === undefined) {
            delete process.env.EMAIL_USER;
        } else {
            process.env.EMAIL_USER = originalEmailUser;
        }

        if (originalEmailPass === undefined) {
            delete process.env.EMAIL_PASS;
        } else {
            process.env.EMAIL_PASS = originalEmailPass;
        }
    }
});

test("OTP delivery verifies Gmail SMTP and a successful OTP creates a one-time login session", async () => {
    const originalEmailHost = process.env.EMAIL_HOST;
    const originalEmailPort = process.env.EMAIL_PORT;
    const originalEmailSecure = process.env.EMAIL_SECURE;
    let transportOptions;
    let transporterVerified = false;
    let sentMessage;

    process.env.EMAIL_USER = "sender@example.com";
    process.env.EMAIL_PASS = "test-app-password";
    process.env.EMAIL_HOST = "smtp.gmail.com";
    process.env.EMAIL_PORT = "465";
    process.env.EMAIL_SECURE = "true";
    User.findOne = async () => ({
        _id: "user-1",
        name: "Traveler",
        email: "traveler@example.com",
        role: "user",
    });
    nodemailer.createTransport = (options) => {
        transportOptions = options;
        return {
            verify: async () => {
                transporterVerified = true;
            },
            sendMail: async (message) => {
                sentMessage = message;
                return { accepted: [message.to], rejected: [] };
            },
        };
    };

    try {
        const requestResponse = makeResponse();
        await requestOtpLogin({ body: { email: " Traveler@Example.com " } }, requestResponse);

        assert.equal(requestResponse.statusCode, 200);
        assert.equal(transporterVerified, true);
        assert.equal(transportOptions.host, "smtp.gmail.com");
        assert.equal(transportOptions.port, 465);
        assert.equal(transportOptions.secure, true);
        assert.match(sentMessage.subject, /OTP Login Code/);
        const otp = sentMessage.html.match(/>(\d{6})</)[1];

        const verifyResponse = makeResponse();
        await verifyOtpLogin({
            body: { email: "traveler@example.com", otp },
        }, verifyResponse);

        assert.equal(verifyResponse.statusCode, 200);
        assert.equal(verifyResponse.body.success, true);
        assert.ok(verifyResponse.body.token);
        assert.equal(verifyResponse.body.user.id, "user-1");

        const reuseResponse = makeResponse();
        await verifyOtpLogin({
            body: { email: "traveler@example.com", otp },
        }, reuseResponse);
        assert.equal(reuseResponse.statusCode, 400);
    } finally {
        User.findOne = originalFindOne;
        nodemailer.createTransport = originalCreateTransport;

        for (const [key, value] of Object.entries({
            EMAIL_USER: originalEmailUser,
            EMAIL_PASS: originalEmailPass,
            EMAIL_HOST: originalEmailHost,
            EMAIL_PORT: originalEmailPort,
            EMAIL_SECURE: originalEmailSecure,
        })) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});

test("SMTP verification failure returns an error without sending or storing a successful OTP", async () => {
    const savedEnv = Object.fromEntries(
        ["EMAIL_USER", "EMAIL_PASS", "EMAIL_HOST", "EMAIL_PORT", "EMAIL_SECURE"]
            .map((key) => [key, process.env[key]])
    );
    const originalConsoleError = console.error;
    let sendMailCalled = false;

    process.env.EMAIL_USER = "sender@example.com";
    process.env.EMAIL_PASS = "test-app-password";
    process.env.EMAIL_HOST = "smtp.gmail.com";
    process.env.EMAIL_PORT = "465";
    process.env.EMAIL_SECURE = "true";
    User.findOne = async () => ({ role: "user" });
    nodemailer.createTransport = () => ({
        verify: async () => {
            const error = new Error("SMTP connection details are deliberately not logged.");
            error.code = "ECONNECTION";
            throw error;
        },
        sendMail: async () => {
            sendMailCalled = true;
            return { accepted: ["traveler@example.com"], rejected: [] };
        },
    });
    console.error = () => {};

    try {
        const response = makeResponse();
        await requestOtpLogin({ body: { email: "traveler@example.com" } }, response);

        assert.equal(response.statusCode, 503);
        assert.match(response.body.message, /check EMAIL_HOST, EMAIL_PORT, and EMAIL_SECURE/i);
        assert.equal(sendMailCalled, false);

        const verifyResponse = makeResponse();
        await verifyOtpLogin({
            body: { email: "traveler@example.com", otp: "123456" },
        }, verifyResponse);
        assert.equal(verifyResponse.statusCode, 400);
    } finally {
        User.findOne = originalFindOne;
        nodemailer.createTransport = originalCreateTransport;
        console.error = originalConsoleError;

        for (const [key, value] of Object.entries(savedEnv)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
});