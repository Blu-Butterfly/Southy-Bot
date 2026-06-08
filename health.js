const fs = require("fs");
const { jsonResponse, knowledgePath, optionsResponse } = require("./_southybot");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  return jsonResponse({
    ok: fs.existsSync(knowledgePath),
    sourceMode: "json",
  });
};
