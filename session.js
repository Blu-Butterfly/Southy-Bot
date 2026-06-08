const { bearerToken, decodeSessionToken, jsonResponse, optionsResponse } = require("./_southybot");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  const session = decodeSessionToken(bearerToken(event));

  if (!session) {
    return jsonResponse({ ok: false, error: "No active session." }, 401);
  }

  return jsonResponse({ ok: true, ...session });
};
