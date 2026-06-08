const { jsonResponse, optionsResponse } = require("./_southybot");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  return jsonResponse({ ok: true });
};
