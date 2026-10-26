const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const googleAuthService = require("../services/googleAuthService");
const { googleLogin, loginUser } = require("./authController");

const originalFindOne = User.findOne;
const originalCreate = User.create;
const originalVerify = googleAuthService.verifyGoogleIdToken;
const originalClientId = process.env.GOOGLE_CLIENT_ID;

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
    User.create = originalCreate;
    googleAuthService.verifyGoogleIdToken = originalVerify;

    if (originalClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
    } else {
        process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
});

test("Google login verifies claims, creates a regular user and returns an application JWT", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    const createdUser = {
        _id: "new-user-id",
        name: "Google Traveler",
        email: "traveler@example.com",
        role: "user",
    };
    const lookups = [];

    googleAuthService.verifyGoogleIdToken = async (idToken) => {
        assert.equal(idToken, "signed-google-id-token");
        return {
            sub: "google-sub-1",
            email: "Traveler@Example.com",
            email_verified: true,
            name: "Google Traveler",
            picture: "https://example.com/profile.jpg",
        };
    };
    User.findOne = async (query) => {
        lookups.push(query);
        return null;
    };
    User.create = async (userData) => {
        assert.deepEqual(userData, {
            name: "Google Traveler",
            email: "traveler@example.com",
            googleId: "google-sub-1",
            profileImage: "https://example.com/profile.jpg",
        });
        return createdUser;
    };

    const response = makeResponse();
    await googleLogin({ body: { idToken: "signed-google-id-token" } }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.user, {
        id: "new-user-id",
        name: "Google Traveler",
        email: "traveler@example.com",
        role: "user",
    });
    assert.equal(jwt.decode(response.body.token).userId, "new-user-id");
    assert.deepEqual(lookups, [
        { googleId: "google-sub-1" },
        { email: "traveler@example.com" },
    ]);
});

test("Google login links a verified email to an existing account without changing its role", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    const existingAdmin = {
        _id: "existing-admin-id",
        name: "Existing Admin",
        email: "admin@example.com",
        role: "admin",
        save: async () => {},
    };
    const queries = [];

    googleAuthService.verifyGoogleIdToken = async () => ({
        sub: "google-admin-sub",
        email: "ADMIN@example.com",
        email_verified: true,
        name: "Google Name",
    });
    User.findOne = async (query) => {
        queries.push(query);
        return query.googleId ? null : existingAdmin;
    };
    User.create = async () => {
        throw new Error("An existing account must be linked, not duplicated.");
    };

    const response = makeResponse();
    await googleLogin({ body: { idToken: "verified-token" } }, response);

    assert.equal(existingAdmin.googleId, "google-admin-sub");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.user.role, "admin");
    assert.deepEqual(queries, [
        { googleId: "google-admin-sub" },
        { email: "admin@example.com" },
    ]);
});

test("Google login rejects unverified email claims before accessing user records", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    googleAuthService.verifyGoogleIdToken = async () => ({
        sub: "google-sub-2",
        email: "traveler@example.com",
        email_verified: false,
    });
    User.findOne = async () => {
        throw new Error("Unverified accounts must not query or create users.");
    };

    const response = makeResponse();
    await googleLogin({ body: { idToken: "unverified-token" } }, response);

    assert.equal(response.statusCode, 401);
    assert.match(response.body.message, /verified email/i);
});

test("Google login reports missing setup and invalid credentials without creating sessions", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const response = makeResponse();
    await googleLogin({ body: { idToken: "token" } }, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body.message, /GOOGLE_CLIENT_ID/);
    assert.match(response.body.message, /restart the backend/i);

    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    googleAuthService.verifyGoogleIdToken = async () => {
        throw new Error("Invalid signature");
    };
    const invalidResponse = makeResponse();
    await googleLogin({ body: { idToken: "invalid-token" } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 401);
});

test("Google verification outages return a retryable service error", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    googleAuthService.verifyGoogleIdToken = async () => {
        const error = new Error("Google certificates are unavailable");
        error.code = "ECONNRESET";
        throw error;
    };

    const response = makeResponse();
    await googleLogin({ body: { idToken: "signed-token" } }, response);

    assert.equal(response.statusCode, 503);
    assert.match(response.body.message, /temporarily unavailable/i);
});

test("Google login requires a credential and password login rejects passwordless Google accounts", async () => {
    const missingTokenResponse = makeResponse();
    await googleLogin({ body: {} }, missingTokenResponse);
    assert.equal(missingTokenResponse.statusCode, 400);

    User.findOne = async () => ({
        _id: "google-user",
        password: undefined,
    });
    const passwordResponse = makeResponse();
    await loginUser({
        body: { email: "google@example.com", password: "some-password" },
    }, passwordResponse);

    assert.equal(passwordResponse.statusCode, 401);
    assert.equal(passwordResponse.body.message, "Invalid email or password");
});
