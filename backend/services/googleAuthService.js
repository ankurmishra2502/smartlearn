const { OAuth2Client } = require("google-auth-library");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleToken(token) {

  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();

  return {
    email: payload.email,
    firstName: payload.given_name,
    lastName: payload.family_name,
    googleId: payload.sub
  };
}

module.exports = verifyGoogleToken;