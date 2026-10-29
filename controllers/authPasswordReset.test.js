const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { afterEach, test } = require("node:test");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const emailService = require("../services/emailService");
const { loginUser, requestPasswordReset, resetPassword } = require("./authController");

const originalFindOne = User.findOne;
const originalFindOneAndUpdate = User.findOneAndUpdate;
const originalUpdateOne = User.updateOne;
const originalSendPasswordResetEmail = emailService.sendPasswordResetEmail;

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

afterEach(() => {
    User.findOne = originalFindOne;
    User.findOneAndUpdate = originalFindOneAndUpdate;
    User.updateOne = originalUpdateOne;
    emailService.sendPasswordResetEmail = originalSendPasswordResetEmail;
});

test("forgot password stores only a 15-minute token hash and returns the same generic response", async () => {
    let savedUser;
    let deliveredEmail;
    const user = {
        _id: "user-1",
        email: "traveler@example.com",
        save: async function save() {
            savedUser = { ...this };
        },
    };
    User.findOne = (query) => {
        assert.deepEqual(query, {
            email: "traveler@example.com",
            password: { $exists: true, $ne: null },
        });
        return {
            select: async (fields) => {
                assert.match(fields, /resetPasswordToken/);
                return user;
            },
        };
    };
    emailService.sendPasswordResetEmail = async (email, token) => {
        deliveredEmail = { email, token };
    };

    const registeredResponse = makeResponse();
    await requestPasswordReset({ body: { email: " Traveler@Example.com " } }, registeredResponse);

    assert.equal(registeredResponse.statusCode, 200);
    assert.match(registeredResponse.body.message, /if an account exists/i);
    assert.equal(deliveredEmail.email, "traveler@example.com");
    assert.equal(savedUser.resetPasswordToken, crypto.createHash("sha256")
        .update(deliveredEmail.token).digest("hex"));
    assert.notEqual(savedUser.resetPasswordToken, deliveredEmail.token);
    assert.equal(savedUser.resetPasswordToken.length, 64);
    assert.ok(savedUser.resetPasswordExpiresAt.getTime() > Date.now());
    assert.ok(savedUser.resetPasswordExpiresAt.getTime() <= Date.now() + 15 * 60 * 1000);
});

test("forgot password returns the same response when no password account is registered", async () => {
    let emailSent = false;
    User.findOne = () => ({ select: async () => null });
    emailService.sendPasswordResetEmail = async () => {
        emailSent = true;
    };

    const response = makeResponse();
    await requestPasswordReset({ body: { email: "missing@example.com" } }, response);

    assert.equal(response.statusCode, 200);
    assert.match(response.body.message, /if an account exists/i);
    assert.equal(emailSent, false);
});

test("forgot password clears the token when mail delivery fails without revealing account status", async () => {
    let clearedToken;
    const user = {
        _id: "user-2",
        email: "traveler@example.com",
        save: async () => {},
    };
    User.findOne = () => ({ select: async () => user });
    User.updateOne = async (query, update) => {
        clearedToken = { query, update };
    };
    emailService.sendPasswordResetEmail = async () => {
        const error = new Error("SMTP details are not sent to clients.");
        error.code = "ECONNECTION";
        throw error;
    };
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        const response = makeResponse();
        await requestPasswordReset({ body: { email: user.email } }, response);
        assert.equal(response.statusCode, 200);
        assert.match(response.body.message, /if an account exists/i);
        assert.equal(clearedToken.query._id, user._id);
        assert.equal(clearedToken.update.$unset.resetPasswordToken, 1);
    } finally {
        console.error = originalConsoleError;
    }
});

test("reset password rejects invalid and expired reset tokens", async () => {
    let query;
    User.findOneAndUpdate = async (filter) => {
        query = filter;
        return null;
    };
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        const response = makeResponse();
        await resetPassword({
            body: { token: "expired-token", password: "new-password", confirmPassword: "new-password" },
        }, response);

        assert.equal(response.statusCode, 400);
        assert.match(response.body.message, /invalid or expired/i);
        assert.equal(query.resetPasswordToken, crypto.createHash("sha256")
            .update("expired-token").digest("hex"));
        assert.ok(query.resetPasswordExpiresAt.$gt instanceof Date);
    } finally {
        console.error = originalConsoleError;
    }
});

test("reset password checks confirmation before querying for a token", async () => {
    User.findOneAndUpdate = async () => {
        throw new Error("Mismatched passwords must be rejected before database access.");
    };

    const response = makeResponse();
    await resetPassword({
        body: { token: "valid-token", password: "new-password", confirmPassword: "different" },
    }, response);

    assert.equal(response.statusCode, 400);
    assert.match(response.body.message, /passwords do not match/i);
});

test("successful reset atomically changes the password, consumes the token, revokes sessions, and permits new login", async () => {
    const rawToken = "single-use-reset-token";
    const oldPasswordHash = await bcrypt.hash("old-password", 10);
    const user = {
        _id: "user-3",
        name: "Traveler",
        email: "traveler@example.com",
        role: "user",
        password: oldPasswordHash,
        tokenVersion: 0,
    };
    let updateQuery;
    let update;
    let resetUsed = false;
    let disconnectedRoom;
    User.findOneAndUpdate = async (filter, updateDocument) => {
        updateQuery = filter;
        update = updateDocument;
        if (resetUsed) return null;
        resetUsed = true;
        user.password = updateDocument.$set.password;
        user.tokenVersion += updateDocument.$inc.tokenVersion;
        return user;
    };
    User.findOne = async () => user;

    const request = {
        body: {
            token: rawToken,
            password: "new-password",
            confirmPassword: "new-password",
        },
        app: {
            get: () => ({
                in: (room) => {
                    disconnectedRoom = room;
                    return { disconnectSockets: (close) => assert.equal(close, true) };
                },
            }),
        },
    };
    const response = makeResponse();
    await resetPassword(request, response);

    assert.equal(response.statusCode, 200);
    assert.equal(updateQuery.resetPasswordToken, crypto.createHash("sha256").update(rawToken).digest("hex"));
    assert.equal(update.$unset.resetPasswordToken, 1);
    assert.equal(update.$unset.resetPasswordExpiresAt, 1);
    assert.equal(update.$inc.tokenVersion, 1);
    assert.equal(await bcrypt.compare("new-password", user.password), true);
    assert.equal(await bcrypt.compare("old-password", user.password), false);
    assert.equal(user.tokenVersion, 1);
    assert.equal(disconnectedRoom, "user:user-3");

    const oldLoginResponse = makeResponse();
    await loginUser({
        body: { email: user.email, password: "old-password" },
    }, oldLoginResponse);
    assert.equal(oldLoginResponse.statusCode, 401);

    const newLoginResponse = makeResponse();
    await loginUser({
        body: { email: user.email, password: "new-password" },
    }, newLoginResponse);
    assert.equal(newLoginResponse.statusCode, 200);
    assert.equal(jwt.decode(newLoginResponse.body.token).tokenVersion, 1);

    const reusedTokenResponse = makeResponse();
    await resetPassword(request, reusedTokenResponse);
    assert.equal(reusedTokenResponse.statusCode, 400);
});
