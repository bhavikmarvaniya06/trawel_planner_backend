const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { OAuth2Client } = require("google-auth-library");
const { verifyGoogleIdToken } = require("./googleAuthService");

const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
const originalClientId = process.env.GOOGLE_CLIENT_ID;

afterEach(() => {
    OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;

    if (originalClientId === undefined) {
        delete process.env.GOOGLE_CLIENT_ID;
    } else {
        process.env.GOOGLE_CLIENT_ID = originalClientId;
    }
});

test("Google ID token verification pins the audience to the configured client ID", async () => {
    process.env.GOOGLE_CLIENT_ID = "tripai-web-client-id";
    const claims = {
        sub: "google-user-id",
        email: "traveler@example.com",
        email_verified: true,
    };
    let verificationOptions;

    OAuth2Client.prototype.verifyIdToken = async (options) => {
        verificationOptions = options;
        return { getPayload: () => claims };
    };

    assert.equal(
        await verifyGoogleIdToken("signed-id-token"),
        claims
    );
    assert.deepEqual(verificationOptions, {
        idToken: "signed-id-token",
        audience: "tripai-web-client-id",
    });
});

test("Google ID token verification fails explicitly when backend configuration is missing", async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    await assert.rejects(
        verifyGoogleIdToken("signed-id-token"),
        /Google Sign-In is not configured/
    );
});
