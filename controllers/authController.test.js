const assert = require("node:assert/strict");
const { test } = require("node:test");
const User = require("../models/User");
const { requestOtpLogin } = require("./authController");

const originalFindOne = User.findOne;
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