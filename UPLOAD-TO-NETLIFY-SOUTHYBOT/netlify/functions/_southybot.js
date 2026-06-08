const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "data");
const knowledgePath = path.join(dataDir, "knowledge-base.json");
const usersPath = path.join(dataDir, "auth-users.json");
const passwordIterations = 120000;
const sessionSecret = process.env.SOUTHYBOT_SESSION_SECRET || "southybot-demo-session-secret";

function jsonResponse(payload, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  };
}

function optionsResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: "",
  };
}

function loadKnowledgeRecords() {
  return JSON.parse(fs.readFileSync(knowledgePath, "utf8"));
}

function loadUsers() {
  return JSON.parse(fs.readFileSync(usersPath, "utf8"));
}

function findUser(role, username) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const normalizedUsername = String(username || "").trim().toLowerCase();

  return loadUsers().find((user) => {
    const aliases = new Set([
      String(user.username || "").toLowerCase(),
      String(user.email || "").toLowerCase(),
      ...(user.aliases || []).map((alias) => String(alias).toLowerCase()),
    ]);

    return String(user.role || "").toLowerCase() === normalizedRole && aliases.has(normalizedUsername);
  });
}

function verifyPassword(password, user) {
  const actualHash = crypto
    .pbkdf2Sync(String(password || ""), String(user.salt || ""), passwordIterations, 32, "sha256")
    .toString("hex");
  const expectedHash = String(user.passwordHash || "");

  return crypto.timingSafeEqual(Buffer.from(actualHash), Buffer.from(expectedHash));
}

function publicUser(user) {
  return {
    id: user.id,
    role: user.role,
    username: user.username,
    email: user.email,
    displayName: user.displayName,
  };
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(input) {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function sign(payloadPart) {
  return crypto.createHmac("sha256", sessionSecret).update(payloadPart).digest("base64url");
}

function createSessionToken(user) {
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const session = {
    user: publicUser(user),
    expiresAt,
    nonce: crypto.randomBytes(12).toString("base64url"),
  };
  const payloadPart = base64Url(JSON.stringify(session));
  return { token: `${payloadPart}.${sign(payloadPart)}`, session };
}

function decodeSessionToken(token) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [payloadPart, signature] = token.split(".");
  const expectedSignature = sign(payloadPart);

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    return null;
  }

  const session = JSON.parse(base64UrlDecode(payloadPart));

  if (Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  return session;
}

function bearerToken(event) {
  const authorization = event.headers.authorization || event.headers.Authorization || "";
  return authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
}

module.exports = {
  bearerToken,
  createSessionToken,
  decodeSessionToken,
  findUser,
  jsonResponse,
  knowledgePath,
  loadKnowledgeRecords,
  optionsResponse,
  publicUser,
  verifyPassword,
};
