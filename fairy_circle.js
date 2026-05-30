// =============================================================================
// fairy_circle.gs — DWYP Operations Platform
// Shared infrastructure. All fairies depend on this file.
// Version: 1.0 | March 2026
// Author: Claude (Anthropic). Never edit directly in Apps Script or via Gemini.
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
// PATCH LOG (Missing Tasks Part 2):
//   #7 — spawnReviseAssetTask(): new exported function. Spawns Revise_[Asset]
//          task for Audra when JT requests revisions. FRIENDLY_NAMES map resolves
//          asset display name. Idempotent — skips spawn if open or in_progress
//          Revise task already exists for the episode. Call site deferred to
//          clerk_fairy rebuild.
//   #8 — dailyPulse() Loop 1 restored: Recording_Reminder date-sync and
//          self-complete. Reads hoisted tasksData snapshot — no extra sheet read.
//   #9 — dailyPulse() Loop 2 restored: Release_Reminder spawn (D-1 + day-of),
//          date-sync, self-complete. Scribe email portion remains deferred.
//          Idempotency via Workflow_Step = "Release_Reminder" — no
//          Release_Reminder_Sent field used. Two spawns per episode (HOST + PRODUCER).
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
 * Returns true if this script execution is serving the staging deployment.
 * Compares ScriptApp.getService().getUrl() against STAGING_DEPLOYMENT_URL
 * stored in production Governance_Config.
 *
 * Comparison is exact-string. The staging URL uses the workspace-scoped
 * path (/a/macros/wiseonewithin.com/...) while production uses the generic
 * path (/macros/...). Do not normalize.
 *
 * Returns false on any error (missing config, no service URL, etc.) — fail
 * closed to production routing rather than risk staging bleed into production.
 */
function isStaging() {
  try {
    var serviceUrl = ScriptApp.getService().getUrl();
    if (!serviceUrl) return false;
    var stagingUrl = getGovernance('STAGING_DEPLOYMENT_URL');
    if (!stagingUrl) return false;
    return serviceUrl === stagingUrl;
  } catch (err) {
    // Fail closed: any error means we treat this as production
    return false;
  }
}

/**
 * Returns the appropriate Master Sheet ID for the current deployment.
 *
 * Production deployment → returns Script Property MASTER_SHEET_ID
 * Staging deployment    → returns Governance_Config STAGING_SHEET_ID
 *
 * Bootstrap note: this function may call getGovernance(), which reads from
 * the production sheet (resolved via Script Property). That's intentional —
 * the routing table lives in production Governance_Config. Only operational
 * reads/writes that go through getMasterSheetId() are routed to staging.
 *
 * Fails closed to production if STAGING_SHEET_ID is missing or empty.
 */
function getMasterSheetId() {
  var productionId = PropertiesService.getScriptProperties().getProperty('MASTER_SHEET_ID');
  if (!isStaging()) return productionId;
  var stagingId = getGovernance('STAGING_SHEET_ID');
  if (!stagingId) {
    // Staging deployment but no staging sheet configured — fail closed
    return productionId;
  }
  return stagingId;
}

/**
 * Increments the version stamp for a named domain in the Versions tab.
 * Uses LockService to prevent concurrent write conflicts.
 * Returns the new version number, or null on error or unknown domain.
 *
 * @param {string} domain     - Domain key (e.g. "tasks", "episodes"). Must exist in Versions tab.
 * @param {string} callerName - Identifier for the Modified_By column (function or fairy name).
 */
function bumpVersion(domain, callerName) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sheetId = getMasterSheetId();
    var ss      = SpreadsheetApp.openById(sheetId);
    var sheet   = ss.getSheetByName("Versions");
    if (!sheet) {
      if (domain !== "audit_trail") logToAuditTrail("bumpVersion", "error", "", "", "[WARNING] bumpVersion: Versions tab not found.", "WARNING");
      else console.error("[bumpVersion] Versions tab not found (audit_trail guard).");
      return null;
    }
    var data = sheet.getDataRange().getValues();
    var now  = new Date();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === domain) {
        var newVersion = (Number(data[i][1]) || 0) + 1;
        sheet.getRange(i + 1, 2, 1, 3).setValues([[newVersion, now, callerName || "system"]]);
        return newVersion;
      }
    }
    if (domain !== "audit_trail") logToAuditTrail("bumpVersion", "error", "", "", "[WARNING] bumpVersion: unknown domain '" + domain + "'.", "WARNING");
    else console.error("[bumpVersion] unknown domain 'audit_trail' (audit_trail guard).");
    return null;
  } catch (err) {
    if (domain !== "audit_trail") logToAuditTrail("bumpVersion", "error", "", "", "[ERROR] bumpVersion failed for '" + domain + "': " + err.message, "ERROR");
    else console.error("[bumpVersion] failed for audit_trail: " + err.message);
    return null;
  } finally {
    try { lock.releaseLock(); } catch (e) {}
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
 * Marcom prose generation, Scribe email drafting.
 */
function callGeminiAPINoSearch(prompt, systemInstruction, agentName) {
  const apiKey = getGovernance("GEMINI_API_KEY");
  const model  = getGovernance("MODEL_NAME") || "gemini-2.5-flash-preview-09-2025";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents:         [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 32768 }
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

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
// GEMINI IMAGE API — CONVERSATIONAL
// History-based image generation for Studio canvas.
// Each call appends both turns to updatedHistory — caller stores and passes back
// on iteration. thoughtSignature fields in model parts must be preserved exactly
// or the next call returns 400.
// sourceImageBase64/sourceMimeType: optional canvas image for first-turn edits.
// =============================================================================

/**
 * Calls Gemini image generation model with conversation memory.
 * Returns { text, base64, mimeType, updatedHistory, tokenCount }.
 * imageHistory: prior {role, parts} turns (pass [] on first call).
 * sourceImageBase64/sourceMimeType: canvas image for first-turn edit context (optional).
 */
function callGeminiImageConversational(prompt, imageHistory, sourceImageBase64, sourceMimeType) {
  const apiKey = getGovernance("GEMINI_API_KEY");
  const model  = getGovernance("STUDIO_IMAGE_MODEL") || "gemini-2.5-flash-image";
  const url    = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Current user turn — include canvas image only on first call (no prior history)
  const currentParts = [];
  if (sourceImageBase64 && sourceMimeType && (!imageHistory || !imageHistory.length)) {
    currentParts.push({ inlineData: { mimeType: sourceMimeType, data: sourceImageBase64 } });
  }
  currentParts.push({ text: prompt });

  const contents = (imageHistory || []).concat([{ role: "user", parts: currentParts }]);

  const payload = {
    contents:         contents,
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
  };

  const response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    logToAuditTrail("Studio_ImageGen", "error", "", "", `[ERROR] Image gen ${responseCode}: ${responseText.substring(0, 300)}`, "ERROR");
    throw new Error(`Gemini image API Error ${responseCode}: ${responseText.substring(0, 300)}`);
  }

  const json      = JSON.parse(responseText);
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content || !candidate.content.parts) {
    const reason = (candidate && candidate.finishReason) || "unknown";
    throw new Error(`Gemini image returned no content. Finish reason: ${reason}.`);
  }

  const responseParts = candidate.content.parts;
  let text     = null;
  let base64   = null;
  let mimeType = null;

  for (let i = 0; i < responseParts.length; i++) {
    if (responseParts[i].inlineData) {
      base64   = responseParts[i].inlineData.data;
      mimeType = responseParts[i].inlineData.mimeType;
    } else if (responseParts[i].text) {
      text = responseParts[i].text;
    }
  }

  if (!base64) throw new Error("No image part found in Gemini image response.");

  // Preserve full parts array (including thoughtSignature) — required for next call
  const updatedHistory = contents.concat([{ role: "model", parts: responseParts }]);
  const tokenCount     = (json.usageMetadata && json.usageMetadata.totalTokenCount) || 0;

  logToAuditTrail("Studio_ImageGen", "state_change", "", "", `Image generated (${base64.length} chars base64).`, "info");

  return { text, base64, mimeType, updatedHistory, tokenCount };
}

// =============================================================================
// CLAUDE API
// Anthropic Messages API. Used for all human-facing copy generation.
// Model and API key are governed by CLAUDE_MODEL and CLAUDE_API_KEY keys.
// history: optional array of { role, content } prior turns for multi-turn context.
// options: optional { maxTokens }
// =============================================================================

/**
 * Calls the Anthropic Messages API (claude-sonnet-4-6 by default).
 * Returns the response text string.
 * history: prior turns as [{ role: "user"|"assistant", content: "..." }]
 * options: { maxTokens }
 */
function callClaudeAPI(prompt, systemInstruction, callerName, history, options) {
  const apiKey   = getGovernance("CLAUDE_API_KEY");
  const model    = getGovernance("CLAUDE_MODEL") || "claude-sonnet-4-6";
  const maxTokens = (options && options.maxTokens) || 8192;
  const url      = "https://api.anthropic.com/v1/messages";

  const messages = [];
  if (history && history.length) {
    for (let i = 0; i < history.length; i++) {
      messages.push(history[i]);
    }
  }
  messages.push({ role: "user", content: prompt });

  const body = {
    model:      model,
    max_tokens: maxTokens,
    messages:   messages
  };
  if (systemInstruction) {
    body.system = systemInstruction;
  }

  const response = UrlFetchApp.fetch(url, {
    method:  "post",
    headers: {
      "x-api-key":         apiKey,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json"
    },
    payload:            JSON.stringify(body),
    muteHttpExceptions: true
  });

  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    logToAuditTrail(callerName, "error", "", "", `[ERROR] Claude API ${responseCode}: ${responseText}`, "ERROR");
    throw new Error(`Claude API Error ${responseCode}: ${responseText}`);
  }

  const json = JSON.parse(responseText);
  return json.content[0].text;
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

    const lines    = text.split(/\r\n|\r|\n/);
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
    const sheetId     = getMasterSheetId();
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
    bumpVersion("audit_trail", "logToAuditTrail");
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
 * @param {string} [taskConfig.assignee]        - Email. Defaults to ASSIGNEE_HOST.
 * @param {string} [taskConfig.assignedBy]      - Actor name or email. Defaults to "The Fairy Team".
 * @param {string} [taskConfig.status]          - Enum: open | in_progress | waiting | complete | cancelled
 * @param {string} [taskConfig.priority]        - Enum: urgent | normal
 * @param {Date}   [taskConfig.dueDate]         - Optional due date.
 * @param {string} [taskConfig.contactId]       - Optional. Links task to a contact record.
 * @param {string} [taskConfig.episodeUid]      - Optional. Links task to an episode.
 * @param {string} [taskConfig.workflowStep]    - Pipeline stage. System tasks only.
 * @param {string} [taskConfig.executiveSummary]- Episode/situation context. System tasks only.
 * @param {string} [taskConfig.payloadLink]     - Drive doc, folder, or external URL.
 * @param {string} [taskConfig.assetId]         - Asset_Library Asset_ID FK. Revision tasks only.
 */
function spawnTask(taskConfig, suppressBump) {
  const scriptProps = PropertiesService.getScriptProperties();
  const sheetId     = getMasterSheetId();
  if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

  const ss    = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheetByName("Tasks");
  if (!sheet) throw new Error("FATAL: Tasks tab not found in master sheet.");

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  const taskId   = generateTaskId();
  const assignee = taskConfig.assignee || getGovernance("ASSIGNEE_HOST");

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
    Revision_Notes:    taskConfig.revisionNotes || "",
    Created_At:        new Date(),
    Completed_At:      "",
    Asset_ID:          taskConfig.assetId          || ""
  };

  // Header-driven row build — immune to column reorder.
  // Any field in the sheet not present in fields{} writes as empty string.
  const row = headers.map(h => {
    const val = fields[h];
    return (val !== undefined && val !== null) ? val : "";
  });

  sheet.appendRow(row);
  if (!suppressBump) bumpVersion("tasks", "spawnTask");

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
function updateTaskStatus(taskId, newStatus, suppressBump) {
  const scriptProps = PropertiesService.getScriptProperties();
  const sheetId     = getMasterSheetId();
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
      if (!suppressBump) bumpVersion("tasks", "updateTaskStatus");
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
 * Spawns a Revise_[Asset] task for Audra when JT requests revisions on a Review task.
 * Exported for call from dwyp_app.gs when JT taps Request Revision in the web app.
 * Idempotent — skips spawn if an open or in_progress Revise task already exists for
 * this episode and asset type.
 *
 * TODO: Web app call site not yet wired — clerk_fairy.gs doPost() not yet rebuilt.
 * Call site: spawnReviseAssetTask(episodeUid, assetType) via dwyp_app.gs once wired.
 *
 * @param {string} episodeUid - Episode UID
 * @param {string} assetType  - Asset key (e.g. "Social_Images", "Reels")
 */
function spawnReviseAssetTask(episodeUid, assetType) {
  const FRIENDLY_NAMES = { "Social_Images": "Images", "Reels": "Reels" };
  const friendlyName   = FRIENDLY_NAMES[assetType] || assetType;
  const workflowKey    = `Revise_${assetType}`;

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = getMasterSheetId();
    if (!sheetId) throw new Error("MASTER_SHEET_ID not set.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Tasks");
    if (!sheet) throw new Error("Tasks tab not found.");

    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const epUidCol   = headers.indexOf("Episode_UID");
    const statusCol  = headers.indexOf("Status");
    const workflowCol = headers.indexOf("Workflow_Step");

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][epUidCol])    !== String(episodeUid)) continue;
      if (String(data[i][workflowCol]) !== workflowKey)        continue;
      const st = String(data[i][statusCol]);
      if (st === "open" || st === "in_progress") {
        logToAuditTrail("Task_Fairy", "state_change", episodeUid, "",
          `[INFO] spawnReviseAssetTask: open ${workflowKey} task already exists — skipping spawn.`, "INFO");
        return;
      }
    }
  } catch (e) {
    logToAuditTrail("Task_Fairy", "error", episodeUid, "",
      `[WARNING] spawnReviseAssetTask idempotency check failed: ${e.message}. Proceeding with spawn.`, "WARNING");
  }

  spawnTask({
    actionTitle:      `JT requested revisions — ${friendlyName}`,
    assignee:         getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:       "The Fairy Team",
    status:           "open",
    priority:         "normal",
    episodeUid:       episodeUid,
    workflowStep:     workflowKey,
    executiveSummary: `JT has reviewed the ${friendlyName} assets and requested revisions. See their notes in the Episode Log.`
  });

  logToAuditTrail("Task_Fairy", "state_change", episodeUid, "",
    `[INFO] Revise task spawned for ${friendlyName} — ${episodeUid}.`, "INFO");
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
 *
 * Returns the parsed manifest object, or null if the file does not exist
 * (expected on first run — callers treat null as "not yet created").
 *
 * Throws with .isManifestCorrupt = true if the file exists but JSON.parse
 * fails. Callers MUST NOT silently create a new manifest over a corrupt one —
 * use patchManifest() which already guards against this, or catch the typed
 * error explicitly.
 *
 * Drive-level errors (folder inaccessible, permission denied) are logged and
 * rethrown as-is.
 */
function getManifest(stagingFolderId) {
  let folder, files;
  try {
    folder = DriveApp.getFolderById(stagingFolderId);
    files  = folder.getFilesByName("episode_manifest.json");
  } catch (driveErr) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      stagingFolderId,
      "",
      `[ERROR] Manifest folder inaccessible: ${driveErr.message}`,
      "ERROR"
    );
    throw driveErr;
  }

  if (!files.hasNext()) return null;  // file not found — expected first-run case

  const raw = files.next().getBlob().getDataAsString();
  try {
    return JSON.parse(raw);
  } catch (parseErr) {
    logToAuditTrail(
      "Jason_Protocol",
      "error",
      stagingFolderId,
      "",
      `[ERROR] Manifest corrupt — JSON.parse failed for folder ${stagingFolderId}: ${parseErr.message}`,
      "ERROR"
    );
    const corruptError         = new Error(`Manifest corrupt in folder ${stagingFolderId}: ${parseErr.message}`);
    corruptError.isManifestCorrupt = true;
    corruptError.folderId          = stagingFolderId;
    throw corruptError;
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

    bumpVersion("manifests", "writeManifest");
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
 * Throws if the manifest is not found.
 * If the manifest is corrupt (getManifest throws with .isManifestCorrupt), logs
 * to Audit Trail, spawns a blocked Audra task, and rethrows — the write is
 * blocked entirely to prevent data loss.
 */
function patchManifest(stagingFolderId, updates) {
  let manifest;
  try {
    manifest = getManifest(stagingFolderId);
  } catch (e) {
    if (e.isManifestCorrupt) {
      logToAuditTrail(
        "Jason_Protocol",
        "error",
        stagingFolderId,
        "",
        `[ERROR] patchManifest blocked — manifest is corrupt. No write performed. Folder: ${stagingFolderId}`,
        "ERROR"
      );
      spawnTask({
        actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        executiveSummary: `episode_manifest.json in folder ${stagingFolderId} failed JSON.parse. A patchManifest write was blocked to prevent data loss. Manually inspect and repair the manifest file, then re-trigger the failed fairy.`
      });
    }
    throw e;
  }
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
    const sheetId     = getMasterSheetId();
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
 * Looks up the Raw_Folder_ID for an episode from the Episodes tab.
 * Named symmetrically with getStagingFolderIdByUid() — reads Raw_Folder_ID.
 * Returns the folder ID string, or null if the episode is not found.
 *
 * @param {string} epUid - Episode_UID to look up
 */
function getRawFolderIdByUid(epUid) {
  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = getMasterSheetId();
    if (!sheetId) throw new Error("MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) throw new Error("Episodes tab not found in master sheet.");

    const data       = sheet.getDataRange().getValues();
    const headers    = data[0];
    const uidCol     = headers.indexOf("Episode_UID");
    const rawFolCol  = headers.indexOf("Raw_Folder_ID");

    if (uidCol === -1 || rawFolCol === -1) {
      throw new Error("Episode_UID or Raw_Folder_ID column not found in Episodes tab.");
    }

    for (let i = 1; i < data.length; i++) {
      if (data[i][uidCol] === epUid) return data[i][rawFolCol] || null;
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
      `[ERROR] getRawFolderIdByUid failed: ${e.message}`,
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
    const sheetId     = getMasterSheetId();
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
    const sheetId      = getMasterSheetId();
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
// Episodes tab schema — v1.5 (15 columns):
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
    const sheetId     = getMasterSheetId();
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
      bumpVersion("episodes", "patchEpisodes");
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
    const sheetId     = getMasterSheetId();
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
        bumpVersion("episodes", "upsertEpisodes");
        logToAuditTrail(agentName, "state_change", episodeData.Episode_UID, episodeData.Contact_ID || "", `[INFO] Episodes row updated.`, "INFO");
        return;
      }
    }

    // --- INSERT: new episode row ---
    // Row built by iterating actual headers — immune to column reorder.
    // Manual columns (Episode_Sequence, Release_Date, Episode_URL) write empty string.
    const DEFAULTS = {
      Status:        "waiting",
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
    bumpVersion("episodes", "upsertEpisodes");
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
    const sheetId     = getMasterSheetId();
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
      visibleTo,
      (logConfig.revisionRound != null ? Number(logConfig.revisionRound) : "")
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
    if (e.isManifestCorrupt) {
      spawnTask({
        episodeUid:       epUid,
        actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        executiveSummary: `episode_manifest.json in folder ${e.folderId || stagingFolderId} failed JSON.parse. A revision-comment write to Production Notes was blocked. Manually inspect and repair the manifest file.`
      });
    }
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
    const sheetId     = getMasterSheetId();
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
// Loop 1  — Recording Date Reminder date-sync and self-complete
// Loop 2  — Release Day reminder spawn (D-1 + day-of fallback), date-sync,
//            self-complete. Restored from v1.5 removal. Scribe email portion
//            remains deferred. Task idempotency (Workflow_Step = "Release_Reminder")
//            is the sole dedup mechanism — Release_Reminder_Sent field not used.
// Loop 3  — Safety audit scan
// Loop 3b — Review_Episode spawn (Video_Status = "ready" detection)
// Loop 4  — _ready subfolder scan
// =============================================================================

function dailyPulse() {
  const agentName = "Daily_Pulse";
  logToAuditTrail(agentName, "human_action", "", "", "[INFO] Daily Pulse running.", "INFO");

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = getMasterSheetId();
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
    const videoStatusCol   = headers.indexOf("Video_Status");
    const imagesStatusCol  = headers.indexOf("Images_Status");
    const recordingDateCol = headers.indexOf("Recording_Date");
    const releaseDateCol   = headers.indexOf("Release_Date");
    const proxyFileIdCol   = headers.indexOf("Proxy_File_ID");

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
    const taskIdCol       = tasksHeaders.indexOf("Task_ID");
    const taskDueDateCol  = tasksHeaders.indexOf("Due_Date");

    // =========================================================================
    // LOOP 1: Recording Date Reminder — D-1 spawn, date-sync, and self-complete
    // Spawn condition: Recording_Date - 1 = today (D-1) or Recording_Date = today
    //   (day-of fallback). Two tasks per episode (HOST + PRODUCER).
    // Idempotency: open Workflow_Step = "Recording_Reminder" is sole dedup.
    // Date-sync: if existing task Due_Date != Recording_Date, update it.
    // Self-complete: if Due_Date <= today, mark task complete.
    // =========================================================================
    let recReminderProcessed = 0;
    let recRemindersSpawned  = 0;

    if (recordingDateCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Recording_Date column not found in Episodes tab. Skipping Recording Reminder sync.", "WARNING");
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrowRec = new Date(today);
      tomorrowRec.setDate(tomorrowRec.getDate() + 1);

      for (let i = 1; i < data.length; i++) {
        const epUid         = data[i][uidCol];
        const status        = String(data[i][statusCol]);
        const recordingDate = data[i][recordingDateCol];
        const guestName     = guestNameCol !== -1 ? data[i][guestNameCol] : epUid;
        const contactId     = contactIdCol !== -1 ? data[i][contactIdCol] : "";

        if (!epUid)                  continue;
        if (status === "archived")   continue;
        if (!recordingDate)          continue;

        const recDate = new Date(recordingDate);
        recDate.setHours(0, 0, 0, 0);

        if (taskEpUidCol === -1 || taskStatusCol === -1 || taskWorkflowCol === -1 ||
            taskIdCol === -1 || taskDueDateCol === -1) continue;

        let existingTaskCount = 0;

        for (let t = 1; t < tasksData.length; t++) {
          if (tasksData[t][taskEpUidCol]    !== epUid)             continue;
          if (String(tasksData[t][taskWorkflowCol]) !== "Recording_Reminder") continue;
          const tStatus = String(tasksData[t][taskStatusCol]);
          if (tStatus !== "open" && tStatus !== "in_progress")     continue;

          existingTaskCount++;
          recReminderProcessed++;

          const rawDue    = tasksData[t][taskDueDateCol];
          const taskDue   = rawDue ? new Date(rawDue) : null;
          if (taskDue) taskDue.setHours(0, 0, 0, 0);

          // Self-complete: Due_Date is today or past
          if (taskDue && taskDue <= today) {
            const taskId = tasksData[t][taskIdCol];
            try {
              updateTaskStatus(String(taskId), "complete", true);
              logToAuditTrail(agentName, "state_change", epUid, "",
                `[INFO] Recording_Reminder task ${taskId} self-completed — due date reached.`, "INFO");
            } catch (e) {
              logToAuditTrail(agentName, "error", epUid, "",
                `[ERROR] Failed to self-complete Recording_Reminder task ${taskId}: ${e.message}`, "ERROR");
            }
            continue;
          }

          // Due_Date update: Recording_Date has changed
          if (taskDue && recDate.getTime() !== taskDue.getTime()) {
            const taskId = tasksData[t][taskIdCol];
            try {
              tasksSheet.getRange(t + 1, taskDueDateCol + 1).setValue(recDate);
              logToAuditTrail(agentName, "state_change", epUid, "",
                `[INFO] Recording_Reminder task ${taskId} Due_Date updated to ${recDate.toDateString()}.`, "INFO");
            } catch (e) {
              logToAuditTrail(agentName, "error", epUid, "",
                `[ERROR] Failed to update Due_Date on Recording_Reminder task ${taskId}: ${e.message}`, "ERROR");
            }
          }
        }

        if (existingTaskCount > 0) continue;  // existing tasks found — skip spawn

        // Determine spawn title based on date proximity
        let spawnTitle = null;
        if (recDate.getTime() === tomorrowRec.getTime()) {
          spawnTitle = `Recording tomorrow — ${guestName}, you've got this!`;
        } else if (recDate.getTime() === today.getTime()) {
          spawnTitle = `Recording is today — ${guestName}, you've got this!`;
        }

        if (!spawnTitle) continue;

        spawnTask({
          actionTitle:      spawnTitle,
          assignee:         getGovernance("ASSIGNEE_HOST"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          dueDate:          recDate,
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Recording_Reminder",
          executiveSummary: `Recording reminder for ${guestName}. Recording date: ${recDate.toDateString()}.`
        }, true);
        spawnTask({
          actionTitle:      spawnTitle,
          assignee:         getGovernance("ASSIGNEE_PRODUCER"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          dueDate:          recDate,
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Recording_Reminder",
          executiveSummary: `Recording reminder for ${guestName}. Recording date: ${recDate.toDateString()}.`
        }, true);
        recRemindersSpawned += 2;
        logToAuditTrail(agentName, "state_change", epUid, contactId,
          `[INFO] Recording_Reminder tasks spawned for ${guestName} (${recDate.toDateString()}).`, "INFO");
      }

      logToAuditTrail(agentName, "state_change", "", "",
        `[INFO] Recording Reminder sync complete. Tasks processed: ${recReminderProcessed}. Tasks spawned: ${recRemindersSpawned}.`, "INFO");
    }

    // =========================================================================
    // LOOP 2: Release Day — spawn reminder and self-complete
    // Spawn condition: Release_Date - 1 = today (D-1) or Release_Date = today
    //   (day-of fallback). Two tasks per episode (HOST + PRODUCER).
    // Idempotency: open Workflow_Step = "Release_Reminder" is sole dedup.
    // Due_Date update: if existing release task and Release_Date changed.
    // Self-complete: if release task Due_Date <= today (morning run on release day).
    // =========================================================================
    let releaseRemindersSpawned = 0;

    if (releaseDateCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Release_Date column not found in Episodes tab. Skipping Release Day loop.", "WARNING");
    } else {
      const todayRel = new Date();
      todayRel.setHours(0, 0, 0, 0);
      const tomorrow = new Date(todayRel);
      tomorrow.setDate(tomorrow.getDate() + 1);

      for (let i = 1; i < data.length; i++) {
        const epUid       = data[i][uidCol];
        const status      = String(data[i][statusCol]);
        const releaseDate = data[i][releaseDateCol];
        const guestName   = guestNameCol !== -1 ? data[i][guestNameCol]  : epUid;
        const contactId   = contactIdCol !== -1 ? data[i][contactIdCol]  : "";

        if (!epUid)                  continue;
        if (status === "archived")   continue;
        if (!releaseDate)            continue;

        const relDate = new Date(releaseDate);
        relDate.setHours(0, 0, 0, 0);

        if (taskEpUidCol === -1 || taskStatusCol === -1 || taskWorkflowCol === -1 ||
            taskIdCol === -1 || taskDueDateCol === -1) continue;

        // Collect all open Release_Reminder tasks for this episode
        let existingTaskCount = 0;
        for (let t = 1; t < tasksData.length; t++) {
          if (tasksData[t][taskEpUidCol]    !== epUid)             continue;
          if (String(tasksData[t][taskWorkflowCol]) !== "Release_Reminder") continue;
          const tStatus = String(tasksData[t][taskStatusCol]);
          if (tStatus !== "open" && tStatus !== "in_progress")     continue;

          existingTaskCount++;

          const rawDue  = tasksData[t][taskDueDateCol];
          const taskDue = rawDue ? new Date(rawDue) : null;
          if (taskDue) taskDue.setHours(0, 0, 0, 0);

          // Self-complete: Due_Date is today or past
          if (taskDue && taskDue <= todayRel) {
            const taskId = tasksData[t][taskIdCol];
            try {
              updateTaskStatus(String(taskId), "complete", true);
              logToAuditTrail(agentName, "state_change", epUid, contactId,
                `[INFO] Release_Reminder task ${taskId} self-completed — release date reached.`, "INFO");
            } catch (e) {
              logToAuditTrail(agentName, "error", epUid, "",
                `[ERROR] Failed to self-complete Release_Reminder task ${taskId}: ${e.message}`, "ERROR");
            }
            continue;
          }

          // Due_Date update: Release_Date has changed
          if (taskDue && relDate.getTime() !== taskDue.getTime()) {
            const taskId = tasksData[t][taskIdCol];
            try {
              tasksSheet.getRange(t + 1, taskDueDateCol + 1).setValue(relDate);
              logToAuditTrail(agentName, "state_change", epUid, contactId,
                `[INFO] Release_Reminder task ${taskId} Due_Date updated to ${relDate.toDateString()}.`, "INFO");
            } catch (e) {
              logToAuditTrail(agentName, "error", epUid, "",
                `[ERROR] Failed to update Due_Date on Release_Reminder task ${taskId}: ${e.message}`, "ERROR");
            }
          }
        }

        if (existingTaskCount > 0) continue;  // existing tasks found — skip spawn

        // Determine spawn title based on date proximity
        let spawnTitle = null;
        if (relDate.getTime() === tomorrow.getTime()) {
          spawnTitle = `Episode drops tomorrow — ${guestName} is almost live!`;
        } else if (relDate.getTime() === todayRel.getTime()) {
          spawnTitle = `Release day! ${guestName} episode is live today.`;
        }

        if (!spawnTitle) continue;

        // Spawn two tasks (HOST + PRODUCER) — spawnTask() supports single assignee only
        spawnTask({
          actionTitle:      spawnTitle,
          assignee:         getGovernance("ASSIGNEE_HOST"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          dueDate:          relDate,
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Release_Reminder",
          executiveSummary: `Release reminder for ${guestName}. Release date: ${relDate.toDateString()}.`
        }, true);
        spawnTask({
          actionTitle:      spawnTitle,
          assignee:         getGovernance("ASSIGNEE_PRODUCER"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          dueDate:          relDate,
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Release_Reminder",
          executiveSummary: `Release reminder for ${guestName}. Release date: ${relDate.toDateString()}.`
        }, true);
        releaseRemindersSpawned += 2;
        logToAuditTrail(agentName, "state_change", epUid, contactId,
          `[INFO] Release_Reminder tasks spawned for ${guestName} (${relDate.toDateString()}).`, "INFO");
      }

      logToAuditTrail(agentName, "state_change", "", "",
        `[INFO] Release Day loop complete. Tasks spawned: ${releaseRemindersSpawned}.`, "INFO");
    }

    // =========================================================================
    // LOOP 3: Safety audit scan
    // =========================================================================
    let safetyScanned = 0;

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
        if (status === "archived") continue;

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

        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, "", `[ERROR] Safety audit scan failed for episode: ${e.message}`, "ERROR");
          if (e.isManifestCorrupt) {
            spawnTask({
              episodeUid:       epUid,
              actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
              assignee:         getGovernance("ASSIGNEE_PRODUCER"),
              assignedBy:       "The Fairy Team",
              status:           "open",
              priority:         "urgent",
              executiveSummary: `episode_manifest.json in folder ${e.folderId || prodFolderId} failed JSON.parse during the daily safety audit scan. Manually inspect and repair the manifest file, then re-run the daily pulse or manually clear the safety_audited flag.`
            }, true);
          }
        }
      }

      logToAuditTrail(agentName, "state_change", "", "", `[INFO] Safety audit scan complete. Episodes checked: ${safetyScanned}. (Safety Fairy retired — pipeline parsing now in housekeeping.gs)`, "INFO");
    }

    // =========================================================================
    // LOOP A: Proxy Detection — RETIRED
    // Detection replaced by Upload_Produced_Episode task completion handler
    // (completeUploadEpisode in dwyp_app.js). Producer marks the task complete
    // after uploading to GCS; handler flips Video_Status → review and spawns
    // Review_Episode. Drive folder-watch no longer needed.
    // =========================================================================

    // =========================================================================
    // LOOP B: Images Detection — Review Images
    // Checks Images/ root in Staging folder for files ready to review.
    // Files placed directly in Images/ (not in subfolders) signal readiness.
    // Idempotency: skips if open or in_progress Review_Images task already exists.
    // =========================================================================
    let imagesDetectScanned = 0;
    let imagesDetectSpawned = 0;

    if (prodFolCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Production_Folder_ID column not found in Episodes tab. Skipping Images detection.", "WARNING");
    } else {
      for (let i = 1; i < data.length; i++) {
        const epUid        = data[i][uidCol];
        const status       = String(data[i][statusCol]);
        const prodFolderId = data[i][prodFolCol];
        const guestName    = guestNameCol !== -1 ? data[i][guestNameCol] : epUid;
        const contactId    = contactIdCol !== -1 ? data[i][contactIdCol] : "";

        if (!epUid)                continue;
        if (status === "archived") continue;
        if (!prodFolderId)         continue;

        imagesDetectScanned++;

        try {
          // Idempotency check — skip if open or in_progress Review_Images task exists
          let reviewTaskExists = false;
          if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
            for (let t = 1; t < tasksData.length; t++) {
              if (tasksData[t][taskEpUidCol]    !== epUid)                   continue;
              if (String(tasksData[t][taskWorkflowCol]) !== "Review_Images") continue;
              const tStatus = String(tasksData[t][taskStatusCol]);
              if (tStatus === "open" || tStatus === "in_progress") {
                reviewTaskExists = true;
                break;
              }
            }
          }
          if (reviewTaskExists) continue;

          // Navigate to Images/ subfolder
          const stagingFolder  = DriveApp.getFolderById(prodFolderId);
          const imagesFolderIt = stagingFolder.getFoldersByName("Images");
          if (!imagesFolderIt.hasNext()) continue;
          const imagesFolder = imagesFolderIt.next();

          // Check for files directly in Images/ root (not in subfolders)
          if (!imagesFolder.getFiles().hasNext()) continue;

          spawnTask({
            actionTitle:      `Review images: ${guestName}`,
            assignee:         getGovernance("ASSIGNEE_HOST"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "normal",
            contactId:        contactId,
            episodeUid:       epUid,
            workflowStep:     "Review_Images",
            executiveSummary: `New images are ready for your review for ${guestName}.`
          }, true);

          imagesDetectSpawned++;
          logToAuditTrail(agentName, "state_change", epUid, contactId,
            `[INFO] Images detected in staging for ${guestName}. Review Images task spawned.`, "INFO");

        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, "",
            `[ERROR] Images detection failed for episode ${epUid}: ${e.message}`, "ERROR");
        }
      }

      logToAuditTrail(agentName, "state_change", "", "",
        `[INFO] Images detection complete. Episodes scanned: ${imagesDetectScanned}. Tasks spawned: ${imagesDetectSpawned}.`, "INFO");
    }

    // =========================================================================
    // LOOP C: Reels Detection — Review Reels
    // Checks Reels/ root in Staging folder for files ready to review.
    // Files placed directly in Reels/ (not in subfolders) signal readiness.
    // Idempotency: skips if open or in_progress Review_Reels task already exists.
    // =========================================================================
    let reelsDetectScanned = 0;
    let reelsDetectSpawned = 0;

    if (prodFolCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[WARNING] Production_Folder_ID column not found in Episodes tab. Skipping Reels detection.", "WARNING");
    } else {
      for (let i = 1; i < data.length; i++) {
        const epUid        = data[i][uidCol];
        const status       = String(data[i][statusCol]);
        const prodFolderId = data[i][prodFolCol];
        const guestName    = guestNameCol !== -1 ? data[i][guestNameCol] : epUid;
        const contactId    = contactIdCol !== -1 ? data[i][contactIdCol] : "";

        if (!epUid)                continue;
        if (status === "archived") continue;
        if (!prodFolderId)         continue;

        reelsDetectScanned++;

        try {
          // Idempotency check — skip if open or in_progress Review_Reels task exists
          let reviewTaskExists = false;
          if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
            for (let t = 1; t < tasksData.length; t++) {
              if (tasksData[t][taskEpUidCol]    !== epUid)                  continue;
              if (String(tasksData[t][taskWorkflowCol]) !== "Review_Reels") continue;
              const tStatus = String(tasksData[t][taskStatusCol]);
              if (tStatus === "open" || tStatus === "in_progress") {
                reviewTaskExists = true;
                break;
              }
            }
          }
          if (reviewTaskExists) continue;

          // Navigate to Reels/ subfolder
          const stagingFolder = DriveApp.getFolderById(prodFolderId);
          const reelsFolderIt = stagingFolder.getFoldersByName("Reels");
          if (!reelsFolderIt.hasNext()) continue;
          const reelsFolder = reelsFolderIt.next();

          // Check for files directly in Reels/ root (not in subfolders)
          if (!reelsFolder.getFiles().hasNext()) continue;

          spawnTask({
            actionTitle:      `Review reels: ${guestName}`,
            assignee:         getGovernance("ASSIGNEE_HOST"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "normal",
            contactId:        contactId,
            episodeUid:       epUid,
            workflowStep:     "Review_Reels",
            executiveSummary: `New reels are ready for your review for ${guestName}.`
          }, true);

          reelsDetectSpawned++;
          logToAuditTrail(agentName, "state_change", epUid, contactId,
            `[INFO] Reels detected in staging for ${guestName}. Review Reels task spawned.`, "INFO");

        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, "",
            `[ERROR] Reels detection failed for episode ${epUid}: ${e.message}`, "ERROR");
        }
      }

      logToAuditTrail(agentName, "state_change", "", "",
        `[INFO] Reels detection complete. Episodes scanned: ${reelsDetectScanned}. Tasks spawned: ${reelsDetectSpawned}.`, "INFO");
    }

    // =========================================================================
    // LOOP D: Transcript Detection — Track A (Index Build) + Track B (Editorial)
    // Scans Staging/Episode/ subfolder for a finished transcript file.
    // Condition A: transcript present + episode_index_v2 not set → buildEpisodeIndexV2
    // Condition B: episode_index_v2 set + show_notes not set → runEditorialPass
    // An episode satisfies at most one condition per pulse run.
    // Only reads manifest when a transcript is confirmed present (minimizes
    // Drive API calls across the episode roster).
    // =========================================================================
    let vertScanned = 0;
    let vertRun     = 0;

    if (prodFolCol === -1) {
      logToAuditTrail(agentName, "error", "", "",
        "[WARNING] Production_Folder_ID column not found. Skipping transcript pipeline scan.", "WARNING");
    } else {
      for (let i = 1; i < data.length; i++) {
        const epUid        = data[i][uidCol];
        const status       = String(data[i][statusCol]);
        const prodFolderId = data[i][prodFolCol];
        const guestName    = guestNameCol !== -1 ? data[i][guestNameCol] : epUid;

        if (!epUid)                continue;
        if (status === "archived") continue;
        if (!prodFolderId)         continue;

        vertScanned++;

        try {
          // Navigate to Episode/ subfolder — transcript lives there (same as proxy_)
          const stagingFolder   = DriveApp.getFolderById(prodFolderId);
          const episodeFolderIt = stagingFolder.getFoldersByName("Episode");
          if (!episodeFolderIt.hasNext()) continue;
          const episodeFolder = episodeFolderIt.next();

          // Scan Episode/ for a finished transcript file (skip proxy_ files)
          const files        = episodeFolder.getFiles();
          let hasTranscript  = false;

          while (files.hasNext()) {
            const f    = files.next();
            const name = f.getName().toLowerCase();
            const mime = f.getMimeType();
            if (name.startsWith("proxy_")) continue;
            if (name.includes("transcript") &&
                (mime === MimeType.PLAIN_TEXT || mime === MimeType.GOOGLE_DOCS || name.endsWith(".txt"))) {
              hasTranscript = true;
              break;
            }
          }

          if (!hasTranscript) continue;

          patchEpisodes(epUid, { Status: "in_production" });

          // Transcript found — check manifest before making the extra Drive read
          const manifest = getManifest(prodFolderId);

          // Condition A — Track A: transcript present + index not built → build index
          if (!manifest || !manifest.episode_index_v2) {
            logToAuditTrail(agentName, "state_change", epUid, "",
              `[INFO] Transcript detected for ${guestName}. episode_index_v2 not set. Running buildEpisodeIndexV2.`, "INFO");
            buildEpisodeIndexV2(epUid, { force: false });
            vertRun++;

          // Condition B — Track B: index built + show notes not set → editorial pass
          } else if (!manifest.show_notes) {
            logToAuditTrail(agentName, "state_change", epUid, "",
              `[INFO] episode_index_v2 set for ${guestName}. show_notes not set. Running runEditorialPass.`, "INFO");
            runEditorialPass(epUid, { force: false });
            vertRun++;
          }

        } catch (e) {
          logToAuditTrail(agentName, "error", epUid, "",
            `[ERROR] Transcript pipeline scan failed for ${epUid}: ${e.message}`, "ERROR");
        }
      }

      logToAuditTrail(agentName, "state_change", "", "",
        `[INFO] Transcript pipeline scan complete. Episodes scanned: ${vertScanned}. Pipeline runs: ${vertRun}.`, "INFO");
    }

    /* SUPERSEDED — Loop 3b replaced by Loop A (file-based proxy detection).
       Video_Status = "ready" was a placeholder trigger that was never properly implemented.
    // =========================================================================
    // LOOP 3b: Review_Episode spawn
    // Detects when Audra has set Video_Status = "ready" on an episode and
    // spawns a Review_Episode task for JT if one doesn't already exist.
    // Payload_Link: Production folder URL (JT navigates from there).
    // Detection signal: Video_Status = "ready" (set manually by Audra).
    // Idempotency: skips spawn if open or in_progress Review_Episode task
    // already exists for this episode.
    // #6 — new loop.
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

        // TODO: payloadLink currently opens a Drive folder. Should open in-app review view once wired.
        const payloadLink = prodFolderId
          ? `https://drive.google.com/drive/folders/${prodFolderId}`
          : "";

        spawnTask({
          actionTitle:      `Review: Episode video — ${guestName}`,
          assignee:         getGovernance("ASSIGNEE_HOST"),
          assignedBy:       "The Fairy Team",
          status:           "open",
          priority:         "normal",
          contactId:        contactId,
          episodeUid:       epUid,
          workflowStep:     "Review_Episode",
          payloadLink:      payloadLink,
          executiveSummary: `The finished episode video for ${guestName} is ready for your review. Tap to watch, then approve or request revisions.`
        });

        reviewEpisodeSpawned++;
        logToAuditTrail(agentName, "state_change", epUid, contactId, `[INFO] Review_Episode task spawned for ${guestName}.`, "INFO");
      }

      logToAuditTrail(agentName, "state_change", "", "", `[INFO] Review_Episode scan complete. Tasks spawned: ${reviewEpisodeSpawned}.`, "INFO");
    }
    */

    /* SUPERSEDED — Loop 4 replaced by Loops A, B, C (direct folder detection).
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

          // TODO: payloadLink should open in-app review view once wired — same as Review_Episode.
          const FRIENDLY_NAMES = { "Social_Images": "Images", "Reels": "Reels" };
          const friendlyName = FRIENDLY_NAMES[baseName] || baseName;

          spawnTask({
            actionTitle:      `Review: ${friendlyName} — ${guestName}`,
            assignee:         getGovernance("ASSIGNEE_HOST"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "normal",
            contactId:        contactId,
            episodeUid:       epUid,
            workflowStep:     `Review_${baseName}`,
            executiveSummary: `Assets are ready for your review. Tap to view, then approve or request revisions.`
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
              actionTitle:      `Ready to file: ${guestName}`,
              assignee:         getGovernance("ASSIGNEE_PRODUCER"),
              assignedBy:       "The Fairy Team",
              status:           "open",
              priority:         "normal",
              contactId:        contactId,
              episodeUid:       epUid,
              workflowStep:     "Filing",
              executiveSummary: `All assets are approved. Tap the button below to trigger Filing Fairy and close out this episode.`
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
    */

    bumpVersion("tasks", "dailyPulse");
    bumpVersion("episodes", "dailyPulse");
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
    const sheetId     = getMasterSheetId();
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
    const sheetId      = getMasterSheetId();
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

// =============================================================================
// NIGHTLY HOUSEKEEPING TRIGGER
// Time-based trigger entry point for housekeeping.gs.
// Requires a time-based trigger set to run nightly in Apps Script
// (Triggers → Add Trigger → triggerNightlyHousekeeping → Time-driven → Day timer).
// No trigger registration code here — trigger must be installed manually.
// =============================================================================

/**
 * Nightly trigger entry point. Calls runHousekeeping() in housekeeping.gs.
 * Install as a time-based trigger (day timer, nightly) in Apps Script.
 * Do not add trigger registration code to this function.
 */
function triggerNightlyHousekeeping() {
  runHousekeeping();
}