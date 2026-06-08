const {
  createSessionToken,
  findUser,
  jsonResponse,
  optionsResponse,
  verifyPassword,
} = require("./_southybot");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed." }, 405);
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const role = String(payload.role || "").trim().toLowerCase();
    const username = String(payload.username || "").trim().toLowerCase();
    const password = String(payload.password || "");

    if (!role || !username || !password) {
      return jsonResponse({ ok: false, error: "Role, username, and password are required." }, 400);
    }

    const user = findUser(role, username);

    if (!user || !verifyPassword(password, user)) {
      return jsonResponse({ ok: false, error: "Invalid login details." }, 401);
    }

    const { token, session } = createSessionToken(user);
    return jsonResponse({
      ok: true,
      token,
      expiresAt: session.expiresAt,
      user: session.user,
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }
};
