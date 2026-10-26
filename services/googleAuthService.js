const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client();

const verifyGoogleIdToken = async (idToken) => {
    const audience = process.env.GOOGLE_CLIENT_ID?.trim();

    if (!audience) {
        throw new Error("Google Sign-In is not configured.");
    }

    const ticket = await client.verifyIdToken({
        idToken,
        audience,
    });

    return ticket.getPayload();
};

module.exports = { verifyGoogleIdToken };
