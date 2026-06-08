const { jsonResponse, loadKnowledgeRecords, optionsResponse } = require("./_southybot");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return optionsResponse();
  }

  const startedAt = Date.now();

  try {
    const records = loadKnowledgeRecords();
    return jsonResponse({
      ok: true,
      source: "json",
      recordCount: records.length,
      durationMs: Date.now() - startedAt,
      records,
    });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message, records: [] }, 500);
  }
};
