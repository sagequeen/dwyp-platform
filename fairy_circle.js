// =============================================================================
// fairy_circle.gs — DWYP Operations Platform
// Shared infrastructure. All fairies depend on this file.
// Version: 1.0 | March 2026
// Author: Claude (Anthropic) — per Preservation Mandate, all GAS code written
//         by Claude only. Never edit directly in Apps Script or via Gemini.
//
// BREAKING CHANGE — logToAuditTrail() signature:
//   Old: logToAuditTrail(agent, action, target, level, message)
//   New: logToAuditTrail(actor, eventCategory, episodeUid, contactId, detail, level)
//   Every call site in every fairy file must use the new signature.
//   Old-signature calls will write to wrong columns without error — silent corruption.
//
// eventCategory enum: error | state_change | human_action
//   error        — any failure, exception, fatal, or blocked state
//   state_change — any system write: manifest patch, task spawn, folder created,
//                  email drafted, log entry written, status update
//   human_action — triggered by human tap (AppSheet webhook, manual call, dailyPulse)
//
// level param (INFO | WARNING | ERROR): not written as its own column.
//   Collapsed into detail as a prefix: "[WARNING] Manifest not found."
//   Audit_Trail remains queryable by eye without a dedicated level column.
//
// PATCH LOG (v1.5 schema sweep — Handoff v33):
//   #1 — spawnTask(): removed Workstream, Category, Source, Fairy_Nudge column
//          writes. Removed workstream and category defaults. Priority default
//          updated: "deep_work" → "normal". JSDoc updated to match.
//   #2 — updateTaskStatus(): fairyNudge parameter and Fairy_Nudge write
//          retired. Signature simplified to (taskId, newStatus).
//   #3 — getStagingFolderIdByUid(): column name updated
//          Staging_Folder_ID → Production_Folder_ID.
//   #4 — upsertEpisodes(): DEFAULTS block updated — removed Pipeline_Status,
//          Production_Status, Release_Reminder_Sent, Workstream. Renamed
//          Staging_Folder_ID → Production_Folder_ID. Column comment updated
//          to reflect 14-column v1.5 Episodes schema.
//   #5 — dailyPulse(): stagingCol retargeted to Production_Folder_ID.
//          Loop 2 (release reminder) removed entirely — depends on retired
//          Release_Reminder_Sent field and unpopulated Scribe keys. Restore
//          in dedicated Scribe session. All spawnTask() calls updated:
//          workstream/category/fairyNudge keys removed, assignedBy normalized
//          to "The Fairy Team", priority deep_work → normal.
//
// PATCH LOG (Review_Episode spoke — Handoff v50):
//   #6 — dailyPulse(): Loop 3b added. Detects Video_Status = "ready" on
//          active episodes and spawns Review_Episode task for JT. Idempotency
//          check: skips spawn if open or in_progress Review_Episode task
//          already exists for the episode. Payload_Link: Production folder URL.
//          Tasks sheet read and column index declarations hoisted above Loop 3
//          so all loops share the same tasksData snapshot.
// =============================================================================


// =============================================================================
// BOOTSTRAP — getGovernance()
//
// Standalone project. Opens the master sheet by ID stored
// in GAS Script Properties. All downstream code calls getGovernance() as before.
//
// To set the bootstrap property:
//   In Apps Script editor → Project Settings → Script Properties
//   Add: MASTER_SHEET_ID = [your sheet ID]
//
// getGovernance() reads MASTER_SHEET_ID from Script Properties on every call.
// This keeps the script portable and decoupled from any specific file binding.
// =============================================================================

/**
 * Reads a key/value pair from the Governance_Config tab.
 * Single source of truth for all API keys, folder IDs, model names, and config values.
 * Opens the master sheet via MASTER_SHEET_ID stored in GAS Script Properties.
 * Returns null if key is not found — callers should handle null gracefully.
 */
function getGovernance(key) {
  const scriptProps = PropertiesService.getScriptProperties();
  const sheetId = scriptProps.getProperty("MASTER_SHEET_ID");
  if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties. Cannot open master sheet.");

  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName("Governance_Config");
  if (!sheet) throw new Error("FATAL: Governance_Config tab not found in master sheet.");

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1];
  }
  return null;
}


/**
 * Looks up the email (User_ID) of the first user matching a given role in the User_Registry tab.
 * User_Registry columns: User_ID (email), Display_Name, Role.
 * Returns null if the tab is missing, the Role column is absent, or no row matches.
 * Fails silently — never throws. Callers (e.g. spawnTask default) must handle null gracefully.
 *
 * @param {string} role - Role value to match against the Role column (e.g. "host", "producer").
 * @returns {string|null} Email address (User_ID), or null if no match found.
 */
function getAssigneeByRole(role) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) {
      logToAuditTrail("fairy_circle", "error", "", "", "[ERROR] getAssigneeByRole: MASTER_SHEET_ID not set in Script Properties.", "ERROR");
      return null;
    }

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("User_Registry");
    if (!sheet) {
      logToAuditTrail("fairy_circle", "error", "", "", "[ERROR] getAssigneeByRole: User_Registry tab not found in master sheet.", "ERROR");
      return null;
    }

    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const userIdCol  = headers.indexOf("User_ID");
    const roleCol    = headers.indexOf("Role");

    if (userIdCol === -1 || roleCol === -1) {
      logToAuditTrail("fairy_circle", "error", "", "", "[ERROR] getAssigneeByRole: User_ID or Role column not found in User_Registry.", "ERROR");
      return null;
    }

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][roleCol]).trim().toLowerCase() === String(role).trim().toLowerCase()) {
        return data[i][userIdCol] || null;
      }
    }

    logToAuditTrail("fairy_circle", "error", "", "", `[WARNING] getAssigneeByRole: no match for role '${role}' in User_Registry.`, "WARNING");
    return null;

  } catch (e) {
    logToAuditTrail("fairy_circle", "error", "", "", `[ERROR] getAssigneeByRole failed: ${e.message}`, "ERROR");
    return null;
  }
}


// =============================================================================
// CONFIG
//
// MASTER_SHEET_ID is not stored here — it lives in Script Properties and is
// read by getGovernance() on every call. Do not cache the spreadsheet object
// at module level; GAS execution context does not guarantee persistence.
// =============================================================================

const CONFIG = {
  HUB_VERSION:           "1.0.2026",
  RETRY_LIMIT:           5,
  PODCAST_NAME:          "Don't Waste Your Pain",
  TRANSCRIPT_CHUNK_SIZE: 15000   // ~15 minutes of transcript text
};

// =============================================================================
// THE CAROUSEL (API ENGINE)
// Centralized Gemini API caller with 5x exponential backoff.
//
// Three variants:
//   callGeminiAPI()         — standard call, no grounding
//   callGeminiAPIGrounded() — with Google Search grounding (Herald research)
//   callGeminiAPINoSearch() — explicitly no search (Safety, Marcom, Scribe)
//
// 429 rate-limit errors use a 30s starting delay (quota window, not transient).
// 500/503 keep 1s start (transient server errors).
// 429 sleep delivered via sleepInChunks() — stays within Apps Script per-call max.
// =============================================================================

/**
 * Standard Gemini API call. No grounding tools attached.
 * Use for general-purpose generation where search grounding adds noise.
 */
function callGeminiAPI(prompt, systemInstruction, agentName) {
  const apiKey = getGovernance("GEMINI_API_KEY");
  const model  = getGovernance("MODEL_NAME") || "gemini-2.5-flash-preview-09-2025";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents:          [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig:  { maxOutputTokens: 32768 }
  };

  let delay = 1000;
  for (let i = 0; i < CONFIG.RETRY_LIMIT; i++) {
    try {
      const response     = UrlFetchApp.fetch(url, {
        method:          "post",
        contentType:     "application/json",
        payload:         JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode === 200) {
        const result = JSON.parse(responseText);
        return result.candidates[0].content.parts[0].text;
      }

      if (responseCode === 429) {
        const rateLimitDelay = i === 0 ? 30000 : delay;
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP 429 — rate limited (quota window). Attempt ${i + 1}. Backing off ${rateLimitDelay / 1000}s.`, "WARNING");
        sleepInChunks(rateLimitDelay);
        delay = rateLimitDelay * 2;
      } else if ([500, 503].includes(responseCode)) {
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP ${responseCode} — transient server error. Attempt ${i + 1}. Backing off ${delay / 1000}s.`, "WARNING");
        Utilities.sleep(delay);
        delay *= 2;
      } else {
        throw new Error(`Critical API Error ${responseCode}: ${responseText}`);
      }
    } catch (e) {
      if (i === CONFIG.RETRY_LIMIT - 1) {
        logToAuditTrail(agentName, "error", "", "", `[ERROR] API failure after ${CONFIG.RETRY_LIMIT} attempts: ${e.message}`, "ERROR");
        throw e;
      }
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
}

/**
 * Gemini API call WITH Google Search grounding.
 * Used by Herald for guest research.
 * Falls back gracefully (returns null) if grounding is unavailable (HTTP 400).
 */
function callGeminiAPIGrounded(prompt, systemInstruction, agentName) {
  const apiKey = getGovernance("GEMINI_API_KEY");
  const model  = getGovernance("MODEL_NAME") || "gemini-2.5-flash-preview-09-2025";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents:          [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools:             [{ google_search: {} }],
    generationConfig:  { maxOutputTokens: 32768 }
  };

  let delay = 1000;
  for (let i = 0; i < CONFIG.RETRY_LIMIT; i++) {
    try {
      const response     = UrlFetchApp.fetch(url, {
        method:          "post",
        contentType:     "application/json",
        payload:         JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode === 200) {
        const result = JSON.parse(responseText);
        return result.candidates[0].content.parts[0].text;
      }

      if (responseCode === 400) {
        logToAuditTrail(agentName, "state_change", "", "", "[WARNING] Google Search grounding returned 400. Caller will fall back to form-data synthesis.", "WARNING");
        return null;
      }

      if (responseCode === 429) {
        const rateLimitDelay = i === 0 ? 30000 : delay;
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP 429 — rate limited (quota window). Attempt ${i + 1}. Backing off ${rateLimitDelay / 1000}s.`, "WARNING");
        sleepInChunks(rateLimitDelay);
        delay = rateLimitDelay * 2;
      } else if ([500, 503].includes(responseCode)) {
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP ${responseCode} — transient server error. Attempt ${i + 1}. Backing off ${delay / 1000}s.`, "WARNING");
        Utilities.sleep(delay);
        delay *= 2;
      } else {
        throw new Error(`Critical API Error ${responseCode}: ${responseText}`);
      }
    } catch (e) {
      if (i === CONFIG.RETRY_LIMIT - 1) {
        logToAuditTrail(agentName, "error", "", "", `[ERROR] Grounded API failure after ${CONFIG.RETRY_LIMIT} attempts: ${e.message}`, "ERROR");
        return null;
      }
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
  return null;
}

/**
 * Gemini API call explicitly WITHOUT web search grounding.
 * Use for structured tasks where grounding adds noise:
 * Safety Fairy forensic audit, Marcom prose generation, Scribe email drafting.
 */
function callGeminiAPINoSearch(prompt, systemInstruction, agentName) {
  const apiKey = getGovernance("GEMINI_API_KEY");
  const model  = getGovernance("MODEL_NAME") || "gemini-2.5-flash-preview-09-2025";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents:          [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig:  { maxOutputTokens: 32768 }
  };

  let delay = 1000;
  for (let i = 0; i < CONFIG.RETRY_LIMIT; i++) {
    try {
      const response     = UrlFetchApp.fetch(url, {
        method:          "post",
        contentType:     "application/json",
        payload:         JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode === 200) {
        const result = JSON.parse(responseText);
        return result.candidates[0].content.parts[0].text;
      }

      if (responseCode === 429) {
        const rateLimitDelay = i === 0 ? 30000 : delay;
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP 429 — rate limited (quota window). Attempt ${i + 1}. Backing off ${rateLimitDelay / 1000}s.`, "WARNING");
        sleepInChunks(rateLimitDelay);
        delay = rateLimitDelay * 2;
      } else if ([500, 503].includes(responseCode)) {
        logToAuditTrail(agentName, "state_change", "", "", `[WARNING] HTTP ${responseCode} — transient server error. Attempt ${i + 1}. Backing off ${delay / 1000}s.`, "WARNING");
        Utilities.sleep(delay);
        delay *= 2;
      } else {
        throw new Error(`Critical API Error ${responseCode}: ${responseText}`);
      }
    } catch (e) {
      if (i === CONFIG.RETRY_LIMIT - 1) {
        logToAuditTrail(agentName, "error", "", "", `[ERROR] API failure after ${CONFIG.RETRY_LIMIT} attempts: ${e.message}`, "ERROR");
        throw e;
      }
      Utilities.sleep(delay);
      delay *= 2;
    }
  }
}

// =============================================================================
// SLEEP HELPER
// Apps Script caps individual Utilities.sleep() calls at a maximum value.
// This helper delivers long waits as a series of 5s increments to stay within
// that cap. Used by all three Carousel variants for 429 rate-limit backoff.
// =============================================================================

/**
 * Sleeps for totalMs milliseconds in 5-second chunks.
 * Prevents "Specified sleep period exceeds maximum" errors from Apps Script
 * when backing off on HTTP 429 rate-limit responses.
 */
function sleepInChunks(totalMs) {
  const chunkMs = 5000;
  let remaining = totalMs;
  while (remaining > 0) {
    Utilities.sleep(Math.min(chunkMs, remaining));
    remaining -= chunkMs;
  }
}

// =============================================================================
// JSON EXTRACTION — TWO-PASS PROTOCOL
// Extracts a valid JSON object from a raw Gemini response.
//
// Pass 1: First-bracket / Last-bracket extraction with control character sanitization.
// Pass 2: If Pass 1 fails, strips markdown fences and attempts largest {...} block.
// Returns { error: "PARSE_ERROR", raw: ... } if both passes fail.
//
// normalizeSmartChars() applied before JSON.parse() in both passes.
// Smart quotes and em-dashes inside string values are normalized to ASCII.
// Prevents parse failures caused by Gemini outputting typographic punctuation
// inside JSON string values.
// =============================================================================

/**
 * Extracts a valid JSON object from a raw Gemini response string.
 * Two-pass approach handles AI chattiness and markdown wrapping robustly.
 * Returns parsed object, or { error: "PARSE_ERROR", raw: <first 500 chars> }.
 */
function extractJson(text) {
  if (!text) return { error: "PARSE_ERROR", raw: "empty response" };

  // --- Pass 1: First-Bracket / Last-Bracket ---
  try {
    const firstBracket = text.indexOf('{');
    const lastBracket  = text.lastIndexOf('}');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      let jsonStr = text.substring(firstBracket, lastBracket + 1);
      jsonStr = normalizeSmartChars(jsonStr);
      jsonStr = jsonStr
        .replace(/\n/g,              "\\n")
        .replace(/\r/g,              "\\r")
        .replace(/\t/g,              "\\t")
        .replace(/[\x00-\x1F\x7F]/g, "");
      return JSON.parse(jsonStr);
    }
  } catch (e) {
    // Fall through to Pass 2
  }

  // --- Pass 2: Largest-Block Scan ---
  try {
    const stripped = text
      .replace(/```json/gi, "")
      .replace(/```/g,      "")
      .trim();

    const firstBracket = stripped.indexOf('{');
    const lastBracket  = stripped.lastIndexOf('}');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      let jsonStr = stripped.substring(firstBracket, lastBracket + 1);
      jsonStr = normalizeSmartChars(jsonStr);
      jsonStr = jsonStr
        .replace(/(?<!\\)\n/g,       "\\n")
        .replace(/(?<!\\)\r/g,       "\\r")
        .replace(/(?<!\\)\t/g,       "\\t")
        .replace(/[\x00-\x1F\x7F]/g, "");
      return JSON.parse(jsonStr);
    }
  } catch (e) {
    // Both passes failed
  }

  return { error: "PARSE_ERROR", raw: text ? text.substring(0, 500) : "empty response" };
}

/**
 * Normalizes typographic / smart characters to ASCII equivalents.
 * Applied inside extractJson() before JSON.parse() to prevent parse failures
 * caused by Gemini outputting curly quotes, apostrophes, or em-dashes inside
 * JSON string values.
 */
function normalizeSmartChars(str) {
  return str
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u2014/g,        "-")
    .replace(/\u2013/g,        "-")
    .replace(/\u2026/g,        "...");
}

// =============================================================================
// FORENSIC CHUNKING ENGINE
// =============================================================================

/**
 * Splits a transcript into chunks and processes each sequentially,
 * carrying a rolling summary so no content is missed across chunk boundaries.
 * Returns Array of { chunk_index, rawText } objects.
 * Error chunks return { chunk_index, error } — caller handles gracefully.
 */
function processForensicTranscript(transcriptText, epUid, agentName, forensicPrompt) {
  const chunks       = splitContentIntoChunks(transcriptText, CONFIG.TRANSCRIPT_CHUNK_SIZE);
  let rollingContext = "No previous context. This is the beginning of the transcript.";
  const fullAnalysis = [];

  logToAuditTrail(agentName, "state_change", epUid, "", `[INFO] Chunking started. Processing ${chunks.length} transcript chunk(s).`, "INFO");

  chunks.forEach((chunk, index) => {
    const prompt = `
[CONTEXT FROM PREVIOUS SEGMENTS]:
${rollingContext}

[TRANSCRIPT SEGMENT ${index + 1} OF ${chunks.length}]:
${chunk}

[YOUR DIRECTIVE]:
${forensicPrompt}
    `;

    const systemInstruction = `You are a content risk auditor for the podcast "${CONFIG.PODCAST_NAME}".
Flag platform risks and listener sensitivity issues only. Plain text output. No JSON. No markdown.`;

    try {
      const response = callGeminiAPINoSearch(prompt, systemInstruction, agentName);

      fullAnalysis.push({ chunk_index: index + 1, rawText: response || "" });

      const lines = (response || "").split("\n").filter(l => l.trim()).slice(-2);
      rollingContext = lines.join(" ") || "Context maintained from previous chunk.";

    } catch (e) {
      logToAuditTrail(agentName, "error", epUid, "", `[ERROR] Chunk ${index + 1} failed: ${e.message}`, "ERROR");
      fullAnalysis.push({ chunk_index: index + 1, error: e.message });
    }
  });

  logToAuditTrail(agentName, "state_change", epUid, "", `[INFO] Chunking complete. All ${chunks.length} chunk(s) processed.`, "INFO");

  return fullAnalysis;
}

/**
 * Splits a text string into sequential chunks of chunkSize characters.
 * Pure utility — no logging, no side effects.
 */
function splitContentIntoChunks(text, chunkSize) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}


// =============================================================================
// TEMPLATE PROMPT EXTRACTION
// =============================================================================

/**
 * Reads the Master Template doc and returns the content under a given section heading.
 * Heading match is case-insensitive. Capture stops at the next heading.
 * Returns empty string if section not found or template doc is unavailable.
 */
function extractPrompt(sectionHeading) {
  try {
    const templateId = getGovernance("MASTER_TEMPLATE_ID");
    if (!templateId) {
      console.error("extractPrompt: MASTER_TEMPLATE_ID not in Governance_Config.");
      return "";
    }

    const doc  = DocumentApp.openById(templateId);
    const body = doc.getBody();
    const text = body.getText();

    const target = sectionHeading.replace(/^#+\s*/, "").trim().toLowerCase();

    const lines    = text.split("\n");
    let capturing  = false;
    const buffer   = [];

    for (const line of lines) {
      const isHeading = /^#+\s/.test(line.trim()) || /^#\s/.test(line.trim());
      const lineText  = line.replace(/^#+\s*/, "").trim().toLowerCase();

      if (isHeading && lineText === target) {
        capturing = true;
        continue;
      }

      if (capturing) {
        if (isHeading) break;
        buffer.push(line);
      }
    }

    const result = buffer.join("\n").trim();
    if (!result) {
      console.warn(`extractPrompt: Section "${sectionHeading}" not found or empty in Master Template.`);
    }
    return result;

  } catch (e) {
    console.error(`extractPrompt error: ${e.message}`);
    return "";
  }
}

/**
 * Extracts a named section from a prose block.
 * Matches headings written as "SECTION NAME:" (ALL CAPS, colon, line break).
 * Captures all content until the next ALL CAPS heading or end of string.
 */
function extractSectionFromProse(proseText, sectionName) {
  if (!proseText || !sectionName) return "";

  const escapedName    = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(
    `(?:^|\\n)\\s*${escapedName}\\s*:?\\s*\\n*([\\s\\S]*?)(?=\\n\\s*[A-Z][A-Z\\s]{2,}:\\s*|$)`,
    "i"
  );

  const match = proseText.match(headingPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  return "";
}

/**
 * Reads a Google Doc and returns its body text as a clean plain string,
 * skipping all heading-styled paragraphs (H1–H6).
 */
function getBodyTextSkippingHeadings(docId) {
  try {
    const doc        = DocumentApp.openById(docId);
    const paragraphs = doc.getBody().getParagraphs();
    const lines      = [];

    for (const para of paragraphs) {
      const heading = para.getHeading();
      if (heading === DocumentApp.ParagraphHeading.NORMAL) {
        lines.push(para.getText());
      }
    }

    return lines.join("\n\n");

  } catch (e) {
    console.error(`getBodyTextSkippingHeadings error (docId: ${docId}): ${e.message}`);
    return "";
  }
}

// =============================================================================
// AUDIT TRAIL
// =============================================================================

/**
 * Appends a row to the Audit_Trail tab.
 * Fails silently — audit logging must never crash a fairy mid-run.
 */
function logToAuditTrail(actor, eventCategory, episodeUid, contactId, detail, level) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) return;

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Audit_Trail");
    if (!sheet) return;

    sheet.appendRow([
      new Date(),
      eventCategory,
      actor,
      episodeUid || "",
      contactId  || "",
      detail     || ""
    ]);
  } catch (e) {
    console.error(`[AUDIT FAIL] ${actor} | ${eventCategory} | ${episodeUid} | ${contactId} | ${detail}`);
  }
}


// =============================================================================
// UID GENERATORS
// =============================================================================

/**
 * Generates a time-based Episode UID.
 * Format: EP-YYMMDD-HHmm (e.g. EP-260315-1430)
 */
function generateEpisodeUid() {
  return "EP-" + Utilities.formatDate(new Date(), "UTC", "yyMMdd-HHmm");
}

/**
 * Generates a UUID v4 string for use as Contact_ID primary key.
 */
function generateContactId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// =============================================================================
// THE TASK FAIRY (Project Manager)
//
// spawnTask() — v1.5 schema. Tasks tab: 15 columns.
//   Task_ID | Action_Title | Assignee | Assigned_By | Status | Priority |
//   Due_Date | Contact_ID | Episode_UID | Workflow_Step | Executive_Summary |
//   Payload_Link | Revision_Notes | Created_At | Completed_At
//
// Removed from v1.4: Workstream, Category, Source, Fairy_Nudge.
// Priority enum: urgent | normal
// Assigned_By: always "The Fairy Team" for system tasks.
//
// updateTaskStatus() — v1.5 schema. fairyNudge parameter retired.
// =============================================================================

/**
 * Appends a new task row to the Tasks tab.
 * All fairy-spawned tasks are written header-driven — immune to column reorder.
 * Assignee defaults to ASSIGNEE_HOST if not provided.
 * Status defaults to "open" if not provided.
 * Priority defaults to "normal" if not provided.
 *
 * @param {Object} taskConfig
 * @param {string} taskConfig.actionTitle       - Short label. Required.
 * @param {string} [taskConfig.assignee]        - Email. Defaults to User_Registry host role.
 * @param {string} [taskConfig.assignedBy]      - Actor name or email. Defaults to "The Fairy Team".
 * @param {string} [taskConfig.status]          - Enum: open | in_progress | waiting | complete | cancelled
 * @param {string} [taskConfig.priority]        - Enum: urgent | normal
 * @param {Date}   [taskConfig.dueDate]         - Optional due date.
 * @param {string} [taskConfig.contactId]       - Optional. Links task to a contact record.
 * @param {string} [taskConfig.episodeUid]      - Optional. Links task to an episode.
 * @param {string} [taskConfig.workflowStep]    - Pipeline stage. System tasks only.
 * @param {string} [taskConfig.executiveSummary]- Episode/situation context. System tasks only.
 * @param {string} [taskConfig.payloadLink]     - Drive doc, folder, or external URL.
 */
function spawnTask(taskConfig) {
  const scriptProps = PropertiesService.getScriptProperties();
  const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
  if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

  const ss    = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName("Tasks");
  if (!sheet) throw new Error("FATAL: Tasks tab not found in master sheet.");

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const taskId   = generateTaskId();
  const assignee = taskConfig.assignee || getAssigneeByRole("host");

  const fields = {
    Task_ID:           taskId,
    Action_Title:      taskConfig.actionTitle      || "",
    Assignee:          assignee,
    Assigned_By:       taskConfig.assignedBy       || "The Fairy Team",
    Status:            taskConfig.status           || "open",
    Priority:          taskConfig.priority         || "normal",
    Due_Date:          taskConfig.dueDate          || "",
    Contact_ID:        taskConfig.contactId        || "",
    Episode_UID:       taskConfig.episodeUid       || "",
    Workflow_Step:     taskConfig.workflowStep     || "",
    Executive_Summary: taskConfig.executiveSummary || "",
    Payload_Link:      taskConfig.payloadLink      || "",
    Revision_Notes:    "",
    Created_At:        new Date(),
    Completed_At:      ""
  };

  // Header-driven row build — immune to column reorder.
  // Any field in the sheet not present in fields{} writes as empty string.
  const row = headers.map(h => {
    const val = fields[h];
    return (val !== undefined && val !== null) ? val : "";
  });

  sheet.appendRow(row);

  logToAuditTrail(
    taskConfig.assignedBy || "The Fairy Team",
    "state_change",
    taskConfig.episodeUid || "",
    taskConfig.contactId  || "",
    `[INFO] Task spawned: [${taskId}] ${taskConfig.actionTitle}`,
    "INFO"
  );
}

/**
 * Updates the Status (and optionally Completed_At) of an existing task.
 * Looks up the task by Task_ID. Logs a warning if not found.
 * #2 — fairyNudge parameter retired. Fairy_Nudge column field remains in
 * schema (non-destructive) but GAS never writes it.
 *
 * @param {string} taskId    - The Task_ID to update.
 * @param {string} newStatus - New status value. Enum: open | in_progress | waiting | complete | cancelled
 */
function updateTaskStatus(taskId, newStatus) {
  const scriptProps = PropertiesService.getScriptProperties();
  const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
  if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

  const ss      = SpreadsheetApp.openById(sheetId);
  const sheet   = ss.getSheetByName("Tasks");
  const data    = sheet.getDataRange().getValues();
  const headers = data[0];

  const taskIdCol    = headers.indexOf("Task_ID");
  const statusCol    = headers.indexOf("Status");
  const completedCol = headers.indexOf("Completed_At");

  for (let i = 1; i < data.length; i++) {
    if (data[i][taskIdCol] === taskId) {
      sheet.getRange(i + 1, statusCol + 1).setValue(newStatus);
      if (newStatus === "complete" || newStatus === "cancelled") {
        sheet.getRange(i + 1, completedCol + 1).setValue(new Date());
      }
      logToAuditTrail(
        "Task_Fairy",
        "state_change",
        "",
        "",
        `[INFO] Task ${taskId} status updated → ${newStatus}`,
        "INFO"
      );
      return;
    }
  }

  logToAuditTrail(
    "Task_Fairy",
    "error",
    "",
    "",
    `[WARNING] Task not found for update: ${taskId}`,
    "WARNING"
  );
}

/**
 * Generates a unique Task_ID.
 * Format: TASK-YYMMDD-HHmm-NNN
 */
function generateTaskId() {
  const timestamp = Utilities.formatDate(new Date(), "UTC", "yyMMdd-HHmm");
  const suffix    = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `TASK-${timestamp}-${suffix}`;
}

// =============================================================================
// THE JASON PROTOCOL (Manifest Read/Write)
//
// getManifest()             — reads episode_manifest.json from a staging folder
// writeManifest()           — creates or overwrites episode_manifest.json
// patchManifest()           — reads, merges updates, writes back
// getStagingFolderIdByUid() — looks up Production_Folder_ID from Episodes tab
//                             by Episode_UID. Named getStagingFolderIdByUid()
//                             for legacy compatibility — reads Production_Folder_ID.
// =============================================================================

/**
 * Reads and parses episode_manifest.json from a staging folder.
 * Returns the parsed manifest object, or null if not found or unreadable.
 */
function getManifest(stagingFolderId) {
  try {
    const folder = DriveApp.getFolderById(stagingFolderId);
    const files  = folder.getFilesByName("episode_manifest.json");
    if (files.hasNext()) {
      const file = files.next();
      return JSON.parse(file.getBlob().getDataAsString());
    }
    return null;
  } catch (e) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      stagingFolderId,
      "",
      `[ERROR] Manifest read failed: ${e.message}`,
      "ERROR"
    );
    return null;
  }
}

/**
 * Creates or overwrites episode_manifest.json in a staging folder.
 */
function writeManifest(stagingFolderId, manifestData) {
  try {
    const folder  = DriveApp.getFolderById(stagingFolderId);
    const content = JSON.stringify(manifestData, null, 2);
    const files   = folder.getFilesByName("episode_manifest.json");

    if (files.hasNext()) {
      files.next().setContent(content);
    } else {
      folder.createFile("episode_manifest.json", content, MimeType.PLAIN_TEXT);
    }

    logToAuditTrail(
      "Jason_Protocol",
      "state_change",
      manifestData.episode_uid || stagingFolderId,
      "",
      `[INFO] Manifest written. Status: ${manifestData.status || "unknown"}`,
      "INFO"
    );
  } catch (e) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      stagingFolderId,
      "",
      `[ERROR] Manifest write failed: ${e.message}`,
      "ERROR"
    );
    throw e;
  }
}

/**
 * Reads the current manifest, merges the provided updates, and writes it back.
 */
function patchManifest(stagingFolderId, updates) {
  const manifest = getManifest(stagingFolderId);
  if (!manifest) throw new Error(`Cannot patch manifest — not found in folder: ${stagingFolderId}`);
  const updated = Object.assign({}, manifest, updates, { last_updated: new Date().toISOString() });
  writeManifest(stagingFolderId, updated);
}

/**
 * Looks up the Production_Folder_ID for an episode from the Episodes tab.
 * Named getStagingFolderIdByUid() for legacy compatibility across all fairy
 * call sites — reads Production_Folder_ID (renamed from Staging_Folder_ID in v1.5).
 * Returns the folder ID string, or null if the episode is not found.
 *
 * #3 — Column name updated: Staging_Folder_ID → Production_Folder_ID.
 *
 * @param {string} epUid - Episode_UID to look up
 */
function getStagingFolderIdByUid(epUid) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("Episodes tab not found in master sheet.");

    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const uidCol     = headers.indexOf("Episode_UID");
    const prodFolCol = headers.indexOf("Production_Folder_ID");

    if (uidCol === -1 || prodFolCol === -1) {
      throw new Error("Episode_UID or Production_Folder_ID column not found in Episodes tab.");
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === epUid) return data[i][prodFolCol] || null;
    }

    logToAuditTrail(
      "Jason_Protocol",
      "error",
      epUid,
      "",
      `[WARNING] Episode_UID "${epUid}" not found in Episodes tab.`,
      "WARNING"
    );
    return null;

  } catch (e) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      epUid,
      "",
      `[ERROR] getStagingFolderIdByUid failed: ${e.message}`,
      "ERROR"
    );
    return null;
  }
}

/**
 * Looks up the Contact_ID for an episode from the Episodes tab.
 * Returns the Contact_ID string, or null if the episode is not found.
 */
function getContactIdByEpisodeUid(epUid) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("MASTER_SHEET_ID not set in Script Properties.");

    const ss      = SpreadsheetApp.openById(sheetId);
    const sheet   = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("Episodes tab not found in master sheet.");

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidCol  = headers.indexOf("Episode_UID");
    const cidCol  = headers.indexOf("Contact_ID");

    if (uidCol === -1 || cidCol === -1) {
      throw new Error("Episode_UID or Contact_ID column not found in Episodes tab.");
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === epUid) return data[i][cidCol] || null;
    }

    logToAuditTrail(
      "Jason_Protocol",
      "error",
      epUid,
      "",
      `[WARNING] Episode_UID "${epUid}" not found in Episodes tab.`,
      "WARNING"
    );
    return null;

  } catch (e) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      epUid,
      "",
      `[ERROR] getContactIdByEpisodeUid failed: ${e.message}`,
      "ERROR"
    );
    return null;
  }
}

/**
 * Reads the Contacts tab and returns Contact_Library_Folder_ID for a given Contact_ID.
 * Returns null if no match found or on any error — never throws.
 */
function getContactLibraryFolderIdByContactId(contactId) {
  try {
    const scriptProps  = PropertiesService.getScriptProperties();
    const sheetId      = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) return null;

    const ss           = SpreadsheetApp.openById(sheetId);
    const sheet        = ss.getSheetByName("Contacts");
    if (!sheet) return null;

    const data         = sheet.getDataRange().getValues();
    const headers      = data[0];
    const contactIdCol = headers.indexOf("Contact_ID");
    const folderIdCol  = headers.indexOf("Contact_Library_Folder_ID");

    if (contactIdCol === -1 || folderIdCol === -1) return null;

    for (let i = 1; i < data.length; i++) {
      if (data[i][contactIdCol] === contactId) return data[i][folderIdCol] || null;
    }
    return null;

  } catch (e) {
    return null;
  }
}

// =============================================================================
// EPISODES TAB WRITERS
//
// patchEpisodes()  — writes specific fields to an existing Episodes row.
// upsertEpisodes() — updates an existing row or appends a new one.
//
// Episodes tab schema — v1.5 (14 columns):
//   Episode_Sequence | Release_Date | Episode_UID | Contact_ID | Guest_Name |
//   Status | Raw_Folder_ID | Production_Folder_ID | Recording_Date |
//   Calendar_Event_ID | Video_Status | Images_Status | Episode_URL | Episode_Type
//
// Manual columns — GAS never writes:
//   Episode_Sequence, Release_Date, Episode_URL
//
// AppSheet-written columns — GAS initializes only, AppSheet owns thereafter:
//   Video_Status, Images_Status
// =============================================================================

/**
 * Writes one or more fields to an Episodes row identified by Episode_UID.
 * Fields is a plain object: { Column_Header_Name: value, ... }
 * Only columns present in the headers row are written.
 * Unknown keys are skipped with a WARNING log — never throws on unknown columns.
 */
function patchEpisodes(epUid, fields) {
  const agentName = "Episodes_Writer";

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("FATAL: Episodes tab not found in master sheet.");

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidCol  = headers.indexOf("Episode_UID");
    if (uidCol === -1) throw new Error("Episode_UID column not found in Episodes tab.");

    let targetRow = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === epUid) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow === -1) {
      logToAuditTrail(agentName, "error", epUid, "", `[WARNING] Episode_UID "${epUid}" not found in Episodes tab. No fields written.`, "WARNING");
      return;
    }

    const written = [];
    const skipped = [];

    Object.keys(fields).forEach(colName => {
      const colIndex = headers.indexOf(colName);
      if (colIndex === -1) {
        skipped.push(colName);
        return;
      }
      sheet.getRange(targetRow, colIndex + 1).setValue(fields[colName]);
      written.push(`${colName}=${fields[colName]}`);
    });

    if (skipped.length > 0) {
      logToAuditTrail(agentName, "error", epUid, "", `[WARNING] Skipped unknown column(s): ${skipped.join(", ")}`, "WARNING");
    }
    if (written.length > 0) {
      logToAuditTrail(agentName, "state_change", epUid, "", `[INFO] Episodes tab updated: ${written.join(", ")}`, "INFO");
    }

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, "", `[ERROR] patchEpisodes failed: ${e.message}`, "ERROR");
    throw e;
  }
}

/**
 * Updates an existing Episodes row by Episode_UID, or appends a new row if not found.
 * On update: writes only fields present in episodeData (header-key matched).
 * On insert: builds row from actual headers — immune to column reorder.
 *
 * Manual columns never written by GAS:
 *   Episode_Sequence, Release_Date, Episode_URL
 *
 * #4 — DEFAULTS updated for v1.5: removed Pipeline_Status, Production_Status,
 *       Release_Reminder_Sent, Workstream. Renamed Staging_Folder_ID →
 *       Production_Folder_ID.
 *
 * @param {Object} episodeData - Flat object. Keys must match Episodes tab header names exactly.
 */
function upsertEpisodes(episodeData) {
  const agentName = "Episodes_Writer";

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("FATAL: Episodes tab not found in master sheet.");

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidCol  = headers.indexOf("Episode_UID");

    // --- UPDATE: episode already exists ---
    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === episodeData.Episode_UID) {
        headers.forEach((h, idx) => {
          if (episodeData[h] !== undefined && episodeData[h] !== "") {
            sheet.getRange(i + 1, idx + 1).setValue(episodeData[h]);
          }
        });
        logToAuditTrail(agentName, "state_change", episodeData.Episode_UID, episodeData.Contact_ID || "", `[INFO] Episodes row updated.`, "INFO");
        return;
      }
    }

    // --- INSERT: new episode row ---
    // Row built by iterating actual headers — immune to column reorder.
    // Manual columns (Episode_Sequence, Release_Date, Episode_URL) write empty string.
    const DEFAULTS = {
      Status:        "active",
      Video_Status:  "pending",
      Images_Status: "pending",
      Episode_Type:  "standard"
    };

    const row = headers.map(h => {
      if (episodeData[h] !== undefined) return episodeData[h];
      if (DEFAULTS[h]    !== undefined) return DEFAULTS[h];
      return "";
    });

    sheet.appendRow(row);

    logToAuditTrail(agentName, "state_change", episodeData.Episode_UID, episodeData.Contact_ID || "", `[INFO] New Episodes row created.`, "INFO");

  } catch (e) {
    logToAuditTrail(agentName, "error", episodeData.Episode_UID || "", "", `[ERROR] upsertEpisodes failed: ${e.message}`, "ERROR");
    throw e;
  }
}

// =============================================================================
// EPISODE LOG WRITER
// =============================================================================

/**
 * Appends a single entry to the Episode_Log tab.
 * Log_ID is auto-generated. Timestamp is auto-set. Resolved defaults to FALSE.
 *
 * @param {Object} logConfig
 * @param {string} logConfig.episodeUid  - Required. Foreign key → Episodes.Episode_UID
 * @param {string} logConfig.author      - Required. Email or fairy name of entry author.
 * @param {string} logConfig.entryType   - Required. Enum: revision | feedback | note | system
 * @param {string} [logConfig.assetType] - Enum: video | images | general. Defaults to "general".
 * @param {string} logConfig.body        - Required. The actual message or note.
 * @param {string} [logConfig.visibleTo] - Enum: both | audra_only | jt_only. Defaults to "both".
 */
function appendEpisodeLog(logConfig) {
  const agentName = "Episode_Log_Writer";

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episode_Log");
    if (!sheet) {
      logToAuditTrail(agentName, "error", logConfig.episodeUid || "", "", `[WARNING] Episode_Log tab not found. Entry not written.`, "WARNING");
      return;
    }

    const logId    = generateLogId();
    const now      = new Date();
    const assetType  = logConfig.assetType  || "general";
    const visibleTo  = logConfig.visibleTo  || "both";

    sheet.appendRow([
      logId,
      logConfig.episodeUid  || "",
      now,
      logConfig.author      || "",
      logConfig.entryType   || "",
      assetType,
      logConfig.body        || "",
      false,
      visibleTo
    ]);

    logToAuditTrail(
      logConfig.author || agentName,
      "state_change",
      logConfig.episodeUid || "",
      "",
      `[INFO] Episode_Log entry written. Type: ${logConfig.entryType}. Asset: ${assetType}.`,
      "INFO"
    );

  } catch (e) {
    logToAuditTrail(
      agentName,
      "error",
      logConfig.episodeUid || "",
      "",
      `[ERROR] appendEpisodeLog failed: ${e.message}`,
      "ERROR"
    );
  }
}

/**
 * Generates a unique Log_ID for Episode_Log entries.
 * Format: LOG-YYMMDD-HHmm-NNN
 */
function generateLogId() {
  const timestamp = Utilities.formatDate(new Date(), "UTC", "yyMMdd-HHmm");
  const suffix    = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `LOG-${timestamp}-${suffix}`;
}

// =============================================================================
// THE SCRIBE (Gmail Draft Architect)
// =============================================================================

/**
 * Creates a draft email in the host's Gmail.
 */
function draftPhaseEmail(emailConfig) {
  try {
    const options = {};
    if (emailConfig.htmlBody) {
      options.htmlBody = emailConfig.htmlBody;
    } else if (emailConfig.isHtml) {
      options.htmlBody = emailConfig.body;
    }

    GmailApp.createDraft(
      emailConfig.to,
      emailConfig.subject,
      emailConfig.plainBody || (emailConfig.isHtml ? "" : emailConfig.body),
      options
    );

    logToAuditTrail(
      "Scribe",
      "state_change",
      emailConfig.episodeUid || "",
      "",
      `[INFO] ${emailConfig.phase} draft created for: ${emailConfig.to}`,
      "INFO"
    );
  } catch (e) {
    logToAuditTrail(
      "Scribe",
      "error",
      emailConfig.episodeUid || "",
      "",
      `[ERROR] Draft creation failed: ${e.message}`,
      "ERROR"
    );
    throw e;
  }
}

/**
 * Generates email copy via Gemini and routes to draftPhaseEmail().
 */
function scribeWriteAndDraft(scribeConfig) {
  const brandVoiceId = getGovernance("BRAND_VOICE_ID");
  let brandVoice = "";
  try {
    brandVoice = DocumentApp.openById(brandVoiceId).getBody().getText();
  } catch (e) {
    logToAuditTrail(
      "Scribe",
      "error",
      scribeConfig.episodeUid || "",
      "",
      `[WARNING] Brand Voice doc could not be loaded. Proceeding without it.`,
      "WARNING"
    );
  }

  const PHASE_TO_TEMPLATE = {
    "Phase1_TechCheck":      "# Email: Lets Schedule",
    "Phase1_Confirmation":   "# Email: Date Confirmed and Tech",
    "Phase2_TechCheck":      "# Email: Lets Schedule",
    "Phase2_PostRecording":  "# Email: Great Interview",
    "Phase2_Reminder":       "# Email: Date Confirmed and Tech",
    "Phase2_Reschedule":     "# Email: Date Confirmed and Tech",
    "Phase3_WeAreLive":      "# Email: Were Live",
    "Phase3_ReviewEpisode":  "# Email: Review Your Episode"
  };

  const templateSection      = PHASE_TO_TEMPLATE[scribeConfig.phase] || null;
  const templateInstructions = templateSection ? extractPrompt(templateSection) : "";

  const systemInstruction = `You are The Scribe for "${CONFIG.PODCAST_NAME}."
You are the voice of the host, ${scribeConfig.hostName}.
Your emails are warm, sincere, visceral, and unflinching — never corporate, never hollow.
${brandVoice ? `\n\nBRAND VOICE GUIDE:\n${brandVoice}` : ""}
${templateInstructions ? `\n\nEMAIL TEMPLATE INSTRUCTIONS (from Master Template — follow these):\n${templateInstructions}` : ""}

CRITICAL OUTPUT RULES:
- Write plain prose. No markdown. No asterisks for bold. No underscores. No bullet points with hyphens.
- Use natural paragraph breaks only.
- First line = subject line (no "Subject:" label).
- Second line blank.
- Then body.
- No commentary, no preamble, no sign-off formatting instructions.`;

  const prompt = `Write an email for the following purpose:
Guest Name: ${scribeConfig.guestName}
Host: ${scribeConfig.hostName}
Purpose: ${scribeConfig.contentPrompt}
Podcast: ${CONFIG.PODCAST_NAME}`;

  const rawEmail = callGeminiAPINoSearch(prompt, systemInstruction, "Scribe");

  const lines     = rawEmail.trim().split("\n");
  const subject   = lines[0].trim();
  const plainBody = lines.slice(2).join("\n").trim();

  const htmlBody = plainBody
    .split(/\n\n+/)
    .map(para => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");

  draftPhaseEmail({
    to:         scribeConfig.to,
    subject:    subject,
    body:       plainBody,
    htmlBody:   htmlBody,
    phase:      scribeConfig.phase,
    episodeUid: scribeConfig.episodeUid
  });
}

// =============================================================================
// DRIVE FILE UTILITIES
// =============================================================================

/**
 * Strips the _ready suffix from a Drive file's name.
 */
function stripReadySuffix(file) {
  const currentName = file.getName();
  const ext = currentName.includes(".")
    ? "." + currentName.split(".").pop()
    : "";
  const base = ext
    ? currentName.slice(0, currentName.lastIndexOf(ext))
    : currentName;

  if (!base.toLowerCase().endsWith("_ready")) {
    logToAuditTrail(
      "Asset_Scanner",
      "state_change",
      "",
      "",
      `[INFO] File "${currentName}" does not end in _ready — no rename needed.`,
      "INFO"
    );
    return;
  }

  const newBase = base.slice(0, base.length - "_ready".length);
  const newName = newBase + ext;
  file.setName(newName);

  logToAuditTrail(
    "Asset_Scanner",
    "state_change",
    "",
    "",
    `[INFO] _ready suffix stripped. Renamed: "${currentName}" → "${newName}"`,
    "INFO"
  );
}

/**
 * Appends a timestamped revision comment to the Production Notes doc for an episode,
 * AND writes a corresponding entry to Episode_Log (Entry_Type: "revision").
 */
function appendRevisionComment(epUid, stagingFolderId, comment, commenter, assetType) {
  const agentName   = "Asset_Scanner";
  const attribution = commenter  || getGovernance("ASSIGNEE_HOST");
  const assetScope  = assetType  || "general";

  appendEpisodeLog({
    episodeUid: epUid,
    author:     attribution,
    entryType:  "revision",
    assetType:  assetScope,
    body:       comment || "No comment provided. See Drive file comments for details.",
    visibleTo:  "both"
  });

  try {
    const manifest = getManifest(stagingFolderId);
    if (!manifest) {
      logToAuditTrail(agentName, "error", epUid, "", `[WARNING] Manifest not found — Production Notes doc entry skipped.`, "WARNING");
      return;
    }

    const notesDocId = manifest.asset_ids ? manifest.asset_ids.production_notes : null;
    if (!notesDocId) {
      logToAuditTrail(agentName, "error", epUid, "", `[WARNING] Production Notes doc ID not in manifest — doc entry skipped.`, "WARNING");
      return;
    }

    const doc       = DocumentApp.openById(notesDocId);
    const body      = doc.getBody();
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");

    body.appendParagraph("─────────────────────────────────────────────");
    body.appendParagraph(`REVISION REQUEST — ${timestamp}`)
      .setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph(`Requested by: ${attribution}`);
    body.appendParagraph(`Asset type: ${assetScope}`);
    body.appendParagraph(comment || "No comment provided. See Drive file comments for details.");

    doc.saveAndClose();

    logToAuditTrail(agentName, "state_change", epUid, "", `[INFO] Revision comment from ${attribution} appended to Production Notes.`, "INFO");

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, "", `[ERROR] Failed to append revision comment to Production Notes: ${e.message}`, "ERROR");
  }
}

// =============================================================================
// EPISODE ROW READER
// =============================================================================

/**
 * Reads a single episode row from the Episodes tab by Episode_UID.
 * Returns a plain object keyed by column header names, or null if not found.
 */
function getEpisodeRow(episodeUid) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("MASTER_SHEET_ID not set in Script Properties.");

    const ss      = SpreadsheetApp.openById(sheetId);
    const sheet   = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("Episodes tab not found in master sheet.");

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidCol  = headers.indexOf("Episode_UID");
    if (uidCol === -1) throw new Error("Episode_UID column not found in Episodes tab.");

    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === episodeUid) {
        const row = {};
        headers.forEach((h, idx) => { row[h] = data[i][idx]; });
        return row;
      }
    }

    return null;

  } catch (e) {
    logToAuditTrail("fairy_circle", "error", episodeUid, "", `[ERROR] getEpisodeRow failed: ${e.message}`, "ERROR");
    return null;
  }
}

// =============================================================================
// DAILY PULSE
// Time-based trigger — runs once daily. eventCategory: human_action
//
// Loop 2 (release reminder) — REMOVED in v1.5 sweep.
//   Depended on Release_Reminder_Sent (retired from Episodes schema) and
//   Scribe template keys not yet populated. Restore in dedicated Scribe
//   session once keys are populated and reminder field design is resolved.
//   Post-run patch queue item: "Restore Loop 2 (release reminder) when
//   Scribe keys are populated and Release_Reminder_Sent field design resolved."
//
// Loop 3  — Safety audit scan
// Loop 3b — Review_Episode spawn (Video_Status = "ready" detection)
// Loop 4  — _ready subfolder scan
// =============================================================================

function dailyPulse() {
  const agentName = "Daily_Pulse";
  logToAuditTrail(agentName, "human_action", "", "", "[INFO] Daily Pulse running.", "INFO");

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) {
      logToAuditTrail(agentName, "error", "", "", "[ERROR] Episodes tab not found. Daily Pulse cannot run.", "ERROR");
      return;
    }

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];

    const uidCol          = headers.indexOf("Episode_UID");
    const statusCol       = headers.indexOf("Status");
    const prodFolCol      = headers.indexOf("Production_Folder_ID");  // #5 — renamed
    const rawFolderCol    = headers.indexOf("Raw_Folder_ID");
    const guestNameCol    = headers.indexOf("Guest_Name");
    const contactIdCol    = headers.indexOf("Contact_ID");
    const videoStatusCol  = headers.indexOf("Video_Status");
    const imagesStatusCol = headers.indexOf("Images_Status");

    if (uidCol === -1 || statusCol === -1 || prodFolCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[ERROR] Required columns missing from Episodes tab (Episode_UID, Status, Production_Folder_ID). Daily Pulse cannot run.", "ERROR");
      return;
    }

    // =========================================================================
    // TASKS SHEET — hoisted above all loops so Loop 3b and Loop 4 share
    // the same snapshot. Read once here; do not re-read inside any loop.
    // #6 — moved from top of Loop 4 to here.
    // =========================================================================
    const tasksSheet   = ss.getSheetByName("Tasks");
    const tasksData    = tasksSheet ? tasksSheet.getDataRange().getValues() : [];
    const tasksHeaders = tasksData.length > 0 ? tasksData[0] : [];

    const taskEpUidCol    = tasksHeaders.indexOf("Episode_UID");
    const taskStatusCol   = tasksHeaders.indexOf("Status");
    const taskWorkflowCol = tasksHeaders.indexOf("Workflow_Step");

    // =========================================================================
    // LOOP 3: Safety audit scan
    // =========================================================================
    let safetyScanned   = 0;
    let safetyTriggered = 0;

    if (rawFolderCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Raw_Folder_ID column not found in Episodes tab. Skipping safety audit scan.", "WARNING");
    } else {
      for (let i = 1; i < data.length; i++) {
        const epUid         = data[i][uidCol];
        const status        = String(data[i][statusCol]);
        const prodFolderId  = data[i][prodFolCol];
        const rawFolderId   = data[i][rawFolderCol];

        if (!epUid)        continue;
        if (!rawFolderId)  continue;
        if (status === "complete") continue;

        safetyScanned++;

        try {
          if (!prodFolderId) {
            logToAuditTrail(agentName, "state_change", epUid, "", "[WARNING] Production_Folder_ID not set — cannot read manifest. Skipping safety audit.", "WARNING");
            continue;
          }

          const manifest = getManifest(prodFolderId);

          if (!manifest) {
            logToAuditTrail(agentName, "state_change", epUid, "", "[WARNING] Manifest not found or unreadable. Skipping safety audit for this episode.", "WARNING");
            continue;
          }

          if (manifest.safety_audited === true) continue;

          logToAuditTrail(agentName, "state_change", epUid, "", "[INFO] safety_audited not true — calling Safety Fairy.", "INFO");
          runSafetyFairy(epUid);
          safetyTriggered++;

        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, "", `[ERROR] Safety audit scan failed for episode: ${e.message}`, "ERROR");
        }
      }

      logToAuditTrail(agentName, "state_change", "", "", `[INFO] Safety audit scan complete. Episodes checked: ${safetyScanned}. Safety Fairy triggered: ${safetyTriggered}.`, "INFO");
    }

    // =========================================================================
    // LOOP 3b: Review_Episode spawn — DEPRECATED (safety net only)
    // Clerk Fairy now bypasses this loop entirely by spawning Review_Episode
    // directly when it completes its workflow. This loop remains as a passive
    // safety net: if Clerk Fairy fails to spawn or is not running, Loop 3b
    // will catch Video_Status = "ready" on the next Daily Pulse and spawn
    // the task as a fallback. Do not delete.
    // Payload_Link: Production folder URL (JT navigates from there).
    // Detection signal: Video_Status = "ready" (set manually by Audra).
    // Idempotency: skips spawn if open or in_progress Review_Episode task
    // already exists for this episode.
    // #6 — new loop. | #7 — flagged deprecated; Clerk Fairy is primary path.
    // =========================================================================
    let reviewEpisodeSpawned = 0;

    if (videoStatusCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Video_Status column not found in Episodes tab. Skipping Review_Episode spawn scan.", "WARNING");
    } else {
      for (let i = 1; i < data.length; i++) {
        const epUid        = data[i][uidCol];
        const status       = String(data[i][statusCol]);
        const prodFolderId = data[i][prodFolCol];
        const guestName    = guestNameCol !== -1 ? data[i][guestNameCol] : epUid;
        const contactId    = contactIdCol !== -1 ? data[i][contactIdCol] : "";
        const videoStatus  = String(data[i][videoStatusCol]);

        if (!epUid)                  continue;
        if (status === "complete")   continue;
        if (videoStatus !== "ready") continue;

        // Idempotency check — skip if open or in_progress Review_Episode task exists
        let reviewEpisodeTaskExists = false;
        if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
          for (let t = 1; t < tasksData.length; t++) {
            const tEpUid    = tasksData[t][taskEpUidCol];
            const tStatus   = String(tasksData[t][taskStatusCol]);
            const tWorkflow = String(tasksData[t][taskWorkflowCol]);

            if (tEpUid    === epUid &&
                tWorkflow === "Review_Episode" &&
                (tStatus  === "open" || tStatus === "in_progress")) {
              reviewEpisodeTaskExists = true;
              break;
            }
          }
        }

        if (reviewEpisodeTaskExists) continue;

        const payloadLink = prodFolderId
          ? `https://drive.google.com/drive/folders/${prodFolderId}`
          : "";

        spawnTask({
          actionTitle:      `Review episode: ${guestName}`,
          assignee:         getAssigneeByRole("host"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Review_Episode",
          payloadLink:      payloadLink,
          executiveSummary: `The finished episode for ${guestName} is ready for your review. Open the production folder to find the video file.`
        });

        reviewEpisodeSpawned++;
        logToAuditTrail(agentName, "state_change", epUid, contactId, `[INFO] Review_Episode task spawned for ${guestName}.`, "INFO");
      }

      logToAuditTrail(agentName, "state_change", "", "", `[INFO] Review_Episode scan complete. Tasks spawned: ${reviewEpisodeSpawned}.`, "INFO");
    }

    // =========================================================================
    // LOOP 4: _ready subfolder scan
    // =========================================================================
    let subfolderScanned = 0;
    let reviewsSpawned   = 0;
    let filingSpawned    = 0;

    for (let i = 1; i < data.length; i++) {
      const epUid        = data[i][uidCol];
      const status       = String(data[i][statusCol]);
      const prodFolderId = data[i][prodFolCol];
      const guestName    = guestNameCol  !== -1 ? data[i][guestNameCol]  : epUid;
      const contactId    = contactIdCol  !== -1 ? data[i][contactIdCol]  : "";
      const videoStatus  = videoStatusCol  !== -1 ? String(data[i][videoStatusCol])  : "";
      const imagesStatus = imagesStatusCol !== -1 ? String(data[i][imagesStatusCol]) : "";

      if (!epUid)        continue;
      if (!prodFolderId) continue;
      if (status === "complete") continue;

      subfolderScanned++;

      try {
        const stagingFolder = DriveApp.getFolderById(prodFolderId);
        const subfolders    = stagingFolder.getFolders();

        while (subfolders.hasNext()) {
          const subfolder     = subfolders.next();
          const subfolderName = subfolder.getName();

          if (!subfolderName.toLowerCase().endsWith("_ready")) continue;

          const baseName = subfolderName.slice(0, subfolderName.toLowerCase().lastIndexOf("_ready"));

          let openTaskExists = false;
          if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
            for (let t = 1; t < tasksData.length; t++) {
              const tEpUid    = tasksData[t][taskEpUidCol];
              const tStatus   = String(tasksData[t][taskStatusCol]);
              const tWorkflow = String(tasksData[t][taskWorkflowCol]);

              if (tEpUid === epUid &&
                  tWorkflow === `Review_${baseName}` &&
                  (tStatus === "open" || tStatus === "in_progress")) {
                openTaskExists = true;
                break;
              }
            }
          }

          if (openTaskExists) continue;

          spawnTask({
            actionTitle:      `Review assets: ${baseName} — ${guestName}`,
            assignee:         getAssigneeByRole("host"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "normal",
            contactId:        contactId,
            episodeUid:       epUid,
            workflowStep:     `Review_${baseName}`,
            executiveSummary: `${baseName} assets are ready for your review.`
          });

          reviewsSpawned++;
          logToAuditTrail(agentName, "state_change", epUid, contactId, `[INFO] Review task spawned for ${baseName} — ${guestName}.`, "INFO");
        }

        const allApproved = videoStatus === "approved" && imagesStatus === "approved";

        if (allApproved) {
          let filingTaskExists = false;
          if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
            for (let t = 1; t < tasksData.length; t++) {
              const tEpUid    = tasksData[t][taskEpUidCol];
              const tStatus   = String(tasksData[t][taskStatusCol]);
              const tWorkflow = String(tasksData[t][taskWorkflowCol]);

              if (tEpUid === epUid &&
                  tWorkflow === "Filing" &&
                  (tStatus === "open" || tStatus === "in_progress")) {
                filingTaskExists = true;
                break;
              }
            }
          }

          if (!filingTaskExists) {
            spawnTask({
              actionTitle:      `All assets approved — file this episode: ${guestName}`,
              assignee:         getAssigneeByRole("producer"),
              assignedBy:       "The Fairy Team",
              status:           "open",
              priority:         "normal",
              contactId:        contactId,
              episodeUid:       epUid,
              workflowStep:     "Filing",
              executiveSummary: `Video and images approved. Episode is ready to file.`
            });

            filingSpawned++;
            logToAuditTrail(agentName, "state_change", epUid, contactId, `[INFO] Filing task spawned for ${guestName} — all assets approved.`, "INFO");
          }
        }

      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, "", `[ERROR] _ready subfolder scan failed for episode: ${e.message}`, "ERROR");
      }
    }

    logToAuditTrail(agentName, "state_change", "", "", `[INFO] _ready subfolder scan complete. Episodes scanned: ${subfolderScanned}. Review tasks spawned: ${reviewsSpawned}. Filing tasks spawned: ${filingSpawned}.`, "INFO");

    logToAuditTrail(agentName, "human_action", "", "", "[INFO] Daily Pulse complete.", "INFO");

  } catch (e) {
    logToAuditTrail(agentName, "error", "", "", `[ERROR] Daily Pulse threw a fatal error: ${e.message}`, "ERROR");
  }
}

/**
 * Resolves a guest's email address from the Contacts tab by Contact_ID.
 */
function resolveEmailByContactId(contactId) {
  if (!contactId) return null;

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) return null;

    const ss      = SpreadsheetApp.openById(sheetId);
    const sheet   = ss.getSheetByName("Contacts");
    if (!sheet) return null;

    const data     = sheet.getDataRange().getValues();
    const headers  = data[0];
    const idCol    = headers.indexOf("Contact_ID");
    const emailCol = headers.indexOf("Email");

    if (idCol === -1 || emailCol === -1) return null;

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === contactId) {
        return data[i][emailCol] || null;
      }
    }

    return null;

  } catch (e) {
    logToAuditTrail("Daily_Pulse", "error", "", contactId, `[WARNING] resolveEmailByContactId failed: ${e.message}`, "WARNING");
    return null;
  }
}

/**
 * Resolves a guest's display name from the Contacts tab by Contact_ID.
 */
function resolveDisplayNameByContactId(contactId) {
  if (!contactId) return null;

  try {
    const scriptProps  = PropertiesService.getScriptProperties();
    const sheetId      = scriptProps.getProperty("MASTER_SHEET_ID");
    if (!sheetId) return null;

    const ss      = SpreadsheetApp.openById(sheetId);
    const sheet   = ss.getSheetByName("Contacts");
    if (!sheet) return null;

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol   = headers.indexOf("Contact_ID");
    const nameCol = headers.indexOf("Display_Name");

    if (idCol === -1 || nameCol === -1) return null;

    for (let i = 1; i < data.length; i++) {
      if (data[i][idCol] === contactId) {
        return data[i][nameCol] || null;
      }
    }

    logToAuditTrail("fairy_circle", "error", "", contactId, `[WARNING] resolveDisplayNameByContactId: no match for Contact_ID "${contactId}".`, "WARNING");
    return null;

  } catch (e) {
    logToAuditTrail("fairy_circle", "error", "", contactId, `[WARNING] resolveDisplayNameByContactId failed: ${e.message}`, "WARNING");
    return null;
  }
}