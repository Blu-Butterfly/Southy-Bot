const RESPONSE_DELAY_MS = 3000;
const SOUTHYBOT_UNVERIFIED_RESPONSE =
  "I don\u2019t have enough verified information on that, but I can help you with related details.";
const SOUTHYBOT_SYSTEM_PROMPT = [
  "SouthyBot is an intelligent, friendly, and highly helpful educational chatbot for Southwestern University students, lecturers, and visitors.",
  "Provide clear, accurate, concise academic and institutional support.",
  "Use a bright, friendly, professional, warm, encouraging, and solution-oriented tone.",
  "Answer only with verified retrieved information when university-specific details are needed.",
  "Never fabricate policies, dates, fees, requirements, or university-specific details.",
  "If verified information is unavailable, use the configured uncertainty response.",
  "Keep responses clean, direct, student-friendly, and educational.",
].join(" ");
let knowledgeBase = [];
let botBusy = false;
let lastCategory = "";

const navToggle = document.querySelector("[data-nav-toggle]");
const nav = document.querySelector("[data-nav]");

if (navToggle && nav) {
  navToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => nav.classList.remove("is-open"));
  });
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ph\.d/g, "phd")
    .replace(/msc/g, "msc")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getQuestionTerms(question) {
  const stopWords = new Set([
    "the",
    "and",
    "for",
    "are",
    "what",
    "where",
    "how",
    "can",
    "with",
    "from",
    "about",
    "school",
    "southwestern",
    "university",
  ]);

  return normalizeText(question)
    .split(" ")
    .filter((term) => term.length > 2 && !stopWords.has(term));
}

function expandQuestion(question) {
  const normalized = normalizeText(question);
  const expansions = [];
  const aliases = {
    accommodation: ["accomodation", "hostel"],
    accomodation: ["accommodation", "hostel"],
    address: ["location", "located", "campus"],
    apply: ["admission", "application", "requirements"],
    fees: ["fee", "tuition", "payment"],
    fee: ["fees", "tuition", "payment"],
    faculties: ["faculty"],
    faculty: ["faculties"],
    hostel: ["accomodation", "accommodation"],
    location: ["address", "located", "campus"],
    postgraduate: ["pgd", "msc", "phd"],
    undergrad: ["undergraduate"],
  };

  Object.entries(aliases).forEach(([term, relatedTerms]) => {
    if (normalized.includes(term)) {
      expansions.push(...relatedTerms);
    }
  });

  if (lastCategory && /\b(same|that|those|them|it|again|another|more)\b/.test(normalized)) {
    expansions.push(lastCategory);
  }

  return normalizeText([question, ...expansions].join(" "));
}

function detectSpecificStudyLevel(question) {
  const normalized = normalizeText(question);

  if (/\b(undergraduate|undergrad)\b/.test(normalized)) {
    return "undergraduate";
  }

  if (/\bpgd\b/.test(normalized)) {
    return "pgd";
  }

  if (/\bmsc\b/.test(normalized)) {
    return "msc";
  }

  if (/\bphd\b/.test(normalized)) {
    return "phd";
  }

  return "";
}

function detectAcademicLevel(question) {
  const normalized = normalizeText(question);
  const match = normalized.match(/\b(100|200|300|400)\s*(level|lvl|l)?\b/);

  return match ? `${match[1]} level` : "";
}

function detectSemester(question) {
  const normalized = normalizeText(question);

  if (/\b(first|1st)\b.*\bsemester\b|\bsemester\b.*\b(first|1st)\b/.test(normalized)) {
    return ["first semester", "1st semester"];
  }

  if (/\b(second|2nd)\b.*\bsemester\b|\bsemester\b.*\b(second|2nd)\b/.test(normalized)) {
    return ["second semester", "2nd semester"];
  }

  return [];
}

function levenshteinDistance(firstValue, secondValue) {
  const first = String(firstValue);
  const second = String(secondValue);
  const matrix = Array.from({ length: first.length + 1 }, () => []);

  for (let index = 0; index <= first.length; index += 1) {
    matrix[index][0] = index;
  }

  for (let index = 0; index <= second.length; index += 1) {
    matrix[0][index] = index;
  }

  for (let row = 1; row <= first.length; row += 1) {
    for (let column = 1; column <= second.length; column += 1) {
      const cost = first[row - 1] === second[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost
      );
    }
  }

  return matrix[first.length][second.length];
}

function hasCloseTerm(sourceTerms, questionTerm) {
  if (questionTerm.length < 5) {
    return false;
  }

  return sourceTerms.some((sourceTerm) => {
    if (sourceTerm.length < 5) {
      return false;
    }

    const allowedDistance = questionTerm.length > 7 ? 2 : 1;
    return levenshteinDistance(sourceTerm, questionTerm) <= allowedDistance;
  });
}

function rowSearchText(row) {
  return normalizeText([
    row.category,
    row.title,
    row.keywords,
    row.content,
  ].join(" "));
}

function scoreKnowledgeRow(row, question, questionTerms) {
  const expandedQuestion = expandQuestion(question);
  const category = normalizeText(row.category);
  const title = normalizeText(row.title);
  const keywords = normalizeText(row.keywords);
  const content = normalizeText(row.content);
  const combined = normalizeText([category, title, keywords, content].join(" "));
  const sourceTerms = combined.split(" ").filter(Boolean);
  let score = 0;

  if (expandedQuestion.includes(category) && category) {
    score += 8;
  }

  if (expandedQuestion.includes(title) && title) {
    score += 10;
  }

  normalizeText(row.keywords)
    .split(" ")
    .filter((term) => term.length > 2)
    .forEach((keyword) => {
      if (expandedQuestion.includes(keyword)) {
        score += 5;
      }
    });

  questionTerms.forEach((term) => {
    if (title.includes(term)) {
      score += 6;
    }

    if (category.includes(term)) {
      score += 5;
    }

    if (keywords.includes(term)) {
      score += 4;
    }

    if (content.includes(term)) {
      score += 3;
    }

    if (hasCloseTerm(sourceTerms, term)) {
      score += 2;
    }
  });

  return score;
}

function searchKnowledgeBase(question) {
  const questionTerms = getQuestionTerms(question);

  if (!questionTerms.length || !knowledgeBase.length) {
    return [];
  }

  const studyLevel = detectSpecificStudyLevel(question);
  const academicLevel = detectAcademicLevel(question);
  const semesterTerms = detectSemester(question);
  let scoredRows = knowledgeBase
    .map((row) => ({ row, score: scoreKnowledgeRow(row, question, questionTerms) }))
    .filter((result) => result.score >= 3)
    .sort((first, second) => second.score - first.score);

  if (!scoredRows.length) {
    return [];
  }

  if (academicLevel) {
    const levelRows = scoredRows.filter((result) => {
      const rowText = normalizeText([result.row.category, result.row.title, result.row.content].join(" "));
      const compactLevel = academicLevel.replace(" level", "l");
      return rowText.includes(academicLevel) || rowText.includes(compactLevel);
    });

    if (levelRows.length) {
      scoredRows = levelRows;
    }
  }

  if (semesterTerms.length) {
    const semesterRows = scoredRows.filter((result) => {
      const rowText = normalizeText([result.row.title, result.row.content].join(" "));
      return semesterTerms.some((term) => rowText.includes(term));
    });

    if (semesterRows.length) {
      scoredRows = semesterRows;
    }
  }

  let bestRows = scoredRows.filter((result) => result.score >= scoredRows[0].score - 3);

  if (studyLevel) {
    const levelRows = bestRows.filter((result) =>
      normalizeText([result.row.title, result.row.content].join(" ")).includes(studyLevel)
    );

    if (levelRows.length) {
      bestRows = levelRows;
    }
  }

  const topCategory = bestRows[0]?.row.category || "";
  const isBroadQuestion = /\b(fees|fee|tuition|contact|faculty|faculties|requirements)\b/.test(
    normalizeText(question)
  );

  if (isBroadQuestion && topCategory && !studyLevel) {
    bestRows = scoredRows.filter((result) => result.row.category === topCategory && result.score >= 3);
  }

  return bestRows.slice(0, 5);
}

function buildBotAnswer(results) {
  if (!results.length) {
    return SOUTHYBOT_UNVERIFIED_RESPONSE;
  }

  const rowsWithContent = results
    .map((result) => result.row)
    .filter((row) => String(row.content || "").trim());

  if (!rowsWithContent.length) {
    return SOUTHYBOT_UNVERIFIED_RESPONSE;
  }

  lastCategory = rowsWithContent[0].category;
  return formatVerifiedAnswer(rowsWithContent);
}

function formatVerifiedAnswer(rows) {
  const answers = uniqueValues(rows.map((row) => row.content));

  if (answers.length === 1) {
    return answers[0];
  }

  return `Here's a quick breakdown:\n${answers.map((answer) => `- ${answer}`).join("\n")}`;
}

function renderRetrievedContext(results) {
  if (!botContext) {
    return;
  }

  if (!results.length) {
    botContext.innerHTML = "<strong>Try another question</strong>Ask about admissions, fees, courses, or campus contact.";
    return;
  }

  botContext.innerHTML = "<strong>Answer ready</strong>SouthyBot found helpful information for your question.";
}

function appendBotMessage(role, label, text) {
  if (!botTranscript) {
    return null;
  }

  const message = document.createElement("article");
  message.className = `chat-message ${role}`;
  message.innerHTML = `<span>${escapeHtml(label)}</span><p>${escapeHtml(text)}</p>`;
  botTranscript.appendChild(message);
  botTranscript.scrollTop = botTranscript.scrollHeight;
  return message;
}

function appendThinkingMessage() {
  if (!botTranscript) {
    return null;
  }

  const message = document.createElement("article");
  message.className = "chat-message assistant thinking";
  message.innerHTML = `
    <span>SouthyBot</span>
    <p class="typing-dots" aria-label="SouthyBot is thinking">
      <i></i><i></i><i></i>
    </p>
  `;
  botTranscript.appendChild(message);
  botTranscript.scrollTop = botTranscript.scrollHeight;
  return message;
}

function setBotBusy(isBusy) {
  botBusy = isBusy;
  botPanel?.classList.toggle("is-busy", isBusy);

  if (botQuestionInput) {
    botQuestionInput.disabled = isBusy;
  }

  if (botSubmitButton) {
    botSubmitButton.disabled = isBusy;
  }

  botSuggestions.forEach((button) => {
    button.disabled = isBusy;
  });
}

async function askSouthyBot(question) {
  const trimmedQuestion = question.trim();

  if (!trimmedQuestion || botBusy) {
    return;
  }

  appendBotMessage("user", "You", trimmedQuestion);
  const thinkingMessage = appendThinkingMessage();
  setBotBusy(true);

  await wait(RESPONSE_DELAY_MS);

  const results = searchKnowledgeBase(trimmedQuestion);
  const answer = buildBotAnswer(results);

  thinkingMessage?.remove();
  appendBotMessage("assistant", "SouthyBot", answer);
  renderRetrievedContext(results);
  setBotBusy(false);
  botQuestionInput?.focus();
}

function buildSuggestedQuestions() {
  return [
    { label: "Admission requirements", question: "How do I apply for admission?" },
    { label: "Undergraduate fees", question: "What are the undergraduate school fees?" },
    { label: "Computer science courses", question: "What are the computer science courses?" },
  ];
}

function renderSuggestions() {
  if (!botSuggestionsWrap) {
    return;
  }

  botSuggestionsWrap.innerHTML = buildSuggestedQuestions()
    .map(
      (suggestion) =>
        `<button type="button" data-bot-suggestion="${escapeHtml(suggestion.question)}">${escapeHtml(suggestion.label)}</button>`
    )
    .join("");

  botSuggestions = document.querySelectorAll("[data-bot-suggestion]");
  botSuggestions.forEach((button) => {
    button.addEventListener("click", () => {
      askSouthyBot(button.dataset.botSuggestion || "");
    });
  });
}

async function loadKnowledgeBase() {
  try {
    const payload = await fetchKnowledgePayload();

    if (!payload.ok || !Array.isArray(payload.records)) {
      throw new Error(payload.error || "SouthyBot returned an invalid response");
    }

    knowledgeBase = payload.records;
    renderSuggestions();
    renderRetrievedContext([]);
  } catch (error) {
    appendBotMessage(
      "assistant",
      "SouthyBot",
      "SouthyBot is reconnecting. Please refresh this page in a moment."
    );

    if (botContext) {
      botContext.innerHTML = `<strong>Connection pending</strong>${escapeHtml(error.message)}`;
    }
  }
}

async function fetchKnowledgePayload() {
  const apiResponse = await fetch(`/api/knowledge-base?ts=${Date.now()}`);

  if (apiResponse.ok) {
    return apiResponse.json();
  }

  const staticResponse = await fetch(`./knowledge-base.json?ts=${Date.now()}`);

  if (!staticResponse.ok) {
    throw new Error("Could not connect to SouthyBot");
  }

  const staticPayload = await staticResponse.json();

  if (Array.isArray(staticPayload)) {
    return {
      ok: true,
      source: "static-json",
      recordCount: staticPayload.length,
      records: staticPayload,
    };
  }

  return staticPayload;
}

const botPanel = document.querySelector(".bot-panel");
const botForm = document.querySelector("[data-bot-form]");
const botQuestionInput = document.querySelector("[data-bot-question]");
const botSubmitButton = document.querySelector(".send-button");
const botTranscript = document.querySelector("[data-bot-transcript]");
const botContext = document.querySelector("[data-bot-context]");
const botSuggestionsWrap = document.querySelector("[data-bot-suggestions]");
let botSuggestions = document.querySelectorAll("[data-bot-suggestion]");

if (botForm && botQuestionInput) {
  botForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = botQuestionInput.value;
    botQuestionInput.value = "";
    askSouthyBot(question);
  });
}

window.SouthyBot = {
  ask: askSouthyBot,
  getPrompt: () => SOUTHYBOT_SYSTEM_PROMPT,
  reloadKnowledgeBase: loadKnowledgeBase,
  search: searchKnowledgeBase,
  getRecords: () => [...knowledgeBase],
};

loadKnowledgeBase();

const loginForm = document.querySelector("[data-login-form]");
const loginMessage = document.querySelector("[data-login-message]");
const loginSubmitButton = document.querySelector(".login-submit");
const roleInput = document.querySelector("[data-role-input]");
const roleTabs = document.querySelectorAll("[data-role-tab]");
const passwordInput = document.querySelector("[data-password-input]");
const passwordToggle = document.querySelector("[data-password-toggle]");

roleTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    roleTabs.forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-selected", "false");
    });

    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");

    if (roleInput) {
      roleInput.value = tab.dataset.roleTab || "student";
    }
  });
});

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener("click", () => {
    const shouldShow = passwordInput.type === "password";
    passwordInput.type = shouldShow ? "text" : "password";
    passwordToggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
    passwordToggle.innerHTML = shouldShow
      ? '<i data-lucide="eye-off"></i>'
      : '<i data-lucide="eye"></i>';

    if (window.lucide) {
      window.lucide.createIcons();
    }
  });
}

function setLoginMessage(text, type = "info") {
  if (!loginMessage) {
    return;
  }

  loginMessage.textContent = text;
  loginMessage.classList.remove("is-error", "is-success");

  if (type === "error") {
    loginMessage.classList.add("is-error");
  }

  if (type === "success") {
    loginMessage.classList.add("is-success");
  }
}

if (loginForm && loginMessage) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(loginForm);
    const role = String(formData.get("role") || "student");
    const username = String(formData.get("username") || "").trim();
    const password = String(formData.get("password") || "");
    const remember = Boolean(formData.get("remember"));

    if (!username || !password) {
      setLoginMessage("Please enter your username and password.", "error");
      return;
    }

    loginSubmitButton?.setAttribute("disabled", "true");
    setLoginMessage("Signing in...");

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          role,
          username,
          password,
          remember,
        }),
      });
      window.clearTimeout(timeoutId);
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "Login failed.");
      }

      const session = {
        token: payload.token,
        expiresAt: payload.expiresAt,
        user: payload.user,
      };
      const storage = remember ? window.localStorage : window.sessionStorage;
      storage.setItem("southybotSession", JSON.stringify(session));
      setLoginMessage(`Welcome, ${payload.user.displayName}. Login successful.`, "success");
      loginForm.reset();
    } catch (error) {
      const message =
        error.name === "AbortError"
          ? "Login is taking too long. Please refresh and try again."
          : error.message || "Login failed.";
      setLoginMessage(message, "error");
    } finally {
      loginSubmitButton?.removeAttribute("disabled");
    }
  });
}

if (window.lucide) {
  window.lucide.createIcons();
}
