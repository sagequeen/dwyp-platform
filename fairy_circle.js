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
//   human_action — triggered by human tap (manual call, dailyPulse)
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
  // DEV OVERRIDE: test harness writes _DEV_OVERRIDE_<key>; cleared in finally. Per-invocation only.
  const devOverride = PropertiesService.getScriptProperties().getProperty('_DEV_OVERRIDE_' + key);
  if (devOverride !== null) {
    console.log('[getGovernance] DEV OVERRIDE active: ' + key + ' = ' + devOverride);
    return devOverride;
  }

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
// Fence-strip + first-bracket/last-bracket isolation, then:
// Pass 1: JSON.parse the block as-is (valid JSON, pretty-printed or compact;
//         typographic characters inside string values are legal JSON and
//         pass through untouched).
// Pass 2: If Pass 1 fails, escape raw control characters INSIDE string
//         literals only (state-machine walk), then parse. Handles Gemini
//         emitting literal newlines/tabs inside JSON string values without
//         corrupting the structural whitespace between tokens.
// Pass 3: If Pass 2 fails, normalizeSmartChars() repair (curly quotes used
//         as JSON delimiters, em-dashes), then ctrl-char escape, then parse.
//         Last resort — may mutate typographic characters inside values.
// Returns { error: "PARSE_ERROR", raw: ... } if all passes fail.
// =============================================================================

/**
 * Extracts a valid JSON object from a raw Gemini response string.
 * Two-pass approach handles AI chattiness and markdown wrapping robustly.
 * Returns parsed object, or { error: "PARSE_ERROR", raw: <first 500 chars> }.
 */
function extractJson(text) {
  if (!text) return { error: "PARSE_ERROR", raw: "empty response" };

  const stripped = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g,      "")
    .trim();

  const firstBracket = stripped.indexOf('{');
  const lastBracket  = stripped.lastIndexOf('}');
  if (firstBracket === -1 || lastBracket <= firstBracket) {
    return { error: "PARSE_ERROR", raw: text.substring(0, 500) };
  }

  const jsonStr = stripped.substring(firstBracket, lastBracket + 1);

  // --- Pass 1: parse as-is ---
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Fall through to Pass 2
  }

  // --- Pass 2: escape control chars inside string literals, then parse ---
  try {
    return JSON.parse(_escapeCtrlCharsInJsonStrings_(jsonStr));
  } catch (e) {
    // Fall through to Pass 3
  }

  // --- Pass 3: smart-char repair (curly-quote delimiters), then parse ---
  try {
    return JSON.parse(_escapeCtrlCharsInJsonStrings_(normalizeSmartChars(jsonStr)));
  } catch (e) {
    // All passes failed
  }

  return { error: "PARSE_ERROR", raw: text.substring(0, 500) };
}

/**
 * Escapes raw control characters that appear INSIDE JSON string literals,
 * leaving structural whitespace between tokens untouched.
 * Newline/CR/tab become their escape sequences; other control chars are
 * dropped. Already-escaped sequences pass through unchanged.
 */
function _escapeCtrlCharsInJsonStrings_(jsonStr) {
  const out = [];
  let inString = false;
  let escaped  = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch);
      continue;
    }
    if (escaped) { out.push(ch); escaped = false; continue; }
    if (ch === '\\') { out.push(ch); escaped = true; continue; }
    if (ch === '"')  { inString = false; out.push(ch); continue; }
    if (ch === '\n') { out.push('\\n'); continue; }
    if (ch === '\r') { out.push('\\r'); continue; }
    if (ch === '\t') { out.push('\\t'); continue; }
    const code = jsonStr.charCodeAt(i);
    if (code < 0x20 || code === 0x7F) continue; // drop other control chars
    out.push(ch);
  }
  return out.join('');
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
    Asset_ID:          taskConfig.assetId          || "",
    Bucket:            taskConfig.bucket            || ""
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
// Web app–written columns — GAS initializes only:
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
      Images_Status: "pending",
      Episode_Type:  "guest"
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
 * Writes a revision comment to Episode_Log (Entry_Type: "revision").
 * Episode_Log is the system of record for revision comments.
 * stagingFolderId is unused but retained — callers pass it positionally.
 */
function appendRevisionComment(epUid, stagingFolderId, comment, commenter, assetType) {
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
// DAILY PULSE — State-driven orchestrator
// Time-based trigger — runs once daily.
//
// Stage 0  — Calendar intake (system-level)
// Stage 1  — upcoming: recording reminders + transcript watch → flip to in_production
// Stage 2  — in_production: content chain (A→B→C, chained-within-pulse) + reel chain
// Stage 3  — review: release reminders + final-video detect (backup path)
// Stage 4  — ready_to_release: no pulse action
// Stage 5+ — live/archived: no pulse action / stub
//
// Loops 1/2/3/B/C/D retired. See DWYP_Orchestrator_Design.md.
// =============================================================================

function dailyPulse() {
  const agentName = "Daily_Pulse";
  logToAuditTrail(agentName, "human_action", "", "", "[INFO] Daily Pulse running.", "INFO");

  try {
    // =========================================================================
    // STAGE 0: Calendar intake (system-level, not per-episode)
    // =========================================================================
    try {
      checkCalendarForInterviews();
    } catch(e) {
      logToAuditTrail(agentName, "error", "", "",
        "[ERROR] Stage 0 (calendar intake) failed: " + e.message, "ERROR");
    }

    const sheetId = getMasterSheetId();
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss = SpreadsheetApp.openById(sheetId);

    // Load Episodes
    const epSheet = ss.getSheetByName("Episodes");
    if (!epSheet) {
      logToAuditTrail(agentName, "error", "", "", "[ERROR] Episodes tab not found. Pulse cannot run.", "ERROR");
      return;
    }
    const epData    = epSheet.getDataRange().getValues();
    const epHeaders = epData[0];

    // Load Tasks (for reminder idempotency + self-complete)
    const tasksSheet   = ss.getSheetByName("Tasks");
    const tasksData    = tasksSheet ? tasksSheet.getDataRange().getValues() : [];
    const tasksHeaders = tasksData.length > 0 ? tasksData[0] : [];

    const today    = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    // Episode column indices (header-driven)
    const uidCol           = epHeaders.indexOf("Episode_UID");
    const statusCol        = epHeaders.indexOf("Status");
    const prodFolCol       = epHeaders.indexOf("Production_Folder_ID");
    const guestNameCol     = epHeaders.indexOf("Guest_Name");
    const contactIdCol     = epHeaders.indexOf("Contact_ID");
    const recordingDateCol = epHeaders.indexOf("Recording_Date");
    const releaseDateCol   = epHeaders.indexOf("Release_Date");
    const finalEpIdCol     = epHeaders.indexOf("Final_Episode_ID");
    const rawFolIdCol      = epHeaders.indexOf("Raw_Folder_ID");

    // Tasks column indices
    const taskEpUidCol    = tasksHeaders.indexOf("Episode_UID");
    const taskStatusCol   = tasksHeaders.indexOf("Status");
    const taskWorkflowCol = tasksHeaders.indexOf("Workflow_Step");
    const taskIdCol       = tasksHeaders.indexOf("Task_ID");
    const taskDueDateCol  = tasksHeaders.indexOf("Due_Date");

    if (uidCol === -1 || statusCol === -1) {
      logToAuditTrail(agentName, "error", "", "",
        "[ERROR] Required columns (Episode_UID, Status) missing from Episodes tab. Pulse cannot run.", "ERROR");
      return;
    }

    const heavyBudget = parseInt(getGovernance("PULSE_HEAVY_PASS_BUDGET") || "2", 10) || 2;
    let heavyUsed = 0;

    // =========================================================================
    // PER-EPISODE ORCHESTRATION
    // =========================================================================
    for (let i = 1; i < epData.length; i++) {
      const epUid = String(epData[i][uidCol] || "");
      if (!epUid) continue;
      const status = String(epData[i][statusCol] || "");
      if (!status || status === "archived") continue;

      const guestName = guestNameCol !== -1 ? String(epData[i][guestNameCol] || epUid) : epUid;
      const contactId = contactIdCol !== -1 ? String(epData[i][contactIdCol] || "")    : "";
      const prodFolId = prodFolCol   !== -1 ? String(epData[i][prodFolCol]   || "")    : "";
      const rawFolId  = rawFolIdCol  !== -1 ? String(epData[i][rawFolIdCol]  || "")    : "";

      try {
        // =======================================================================
        // STAGE 1: upcoming → recording reminders + transcript watch
        // =======================================================================
        if (status === "upcoming") {
          if (recordingDateCol !== -1 && taskEpUidCol !== -1 &&
              taskStatusCol !== -1 && taskWorkflowCol !== -1 &&
              taskIdCol !== -1 && taskDueDateCol !== -1) {
            _pulse_recordingReminders(
              epUid, guestName, contactId, epData[i][recordingDateCol],
              today, tomorrow, tasksData, tasksSheet,
              taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, agentName
            );
          }
          // §1: Spawn Upload_Raw_Assets task on or after recording day (window math — AD #126)
          if (recordingDateCol !== -1 && taskEpUidCol !== -1 &&
              taskStatusCol !== -1 && taskWorkflowCol !== -1) {
            const recDateVal = epData[i][recordingDateCol];
            if (recDateVal) {
              const recDay = new Date(recDateVal); recDay.setHours(0, 0, 0, 0);
              if (recDay.getTime() <= today.getTime()) {
                _pulse_spawnUploadRawTask(epUid, guestName, contactId, rawFolId,
                  tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol, agentName);
              }
            }
          }
          // Transcript watch: transcript detected → flip to in_production + run chain
          if (prodFolId && _pulse_detectTranscript(prodFolId)) {
            _pulse_completeUploadRawTask(epUid, agentName); // §2 auto-complete on transcript detect
            patchEpisodes(epUid, { Status: "in_production" });
            _pulse_spawnUploadTask(epUid, guestName, contactId, tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol);
            heavyUsed += _pulse_contentChain(epUid, guestName, prodFolId, agentName, heavyBudget - heavyUsed);
            _pulse_reelChain(epUid, guestName, agentName);
          }
        }

        // =======================================================================
        // STAGE 2: in_production → content pipeline + reel chain
        // =======================================================================
        else if (status === "in_production") {
          _pulse_spawnUploadTask(epUid, guestName, contactId, tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol);
          if (prodFolId) {
            heavyUsed += _pulse_contentChain(epUid, guestName, prodFolId, agentName, heavyBudget - heavyUsed);
            _pulse_reelChain(epUid, guestName, agentName);
          }
        }

        // =======================================================================
        // STAGE 3: review → release reminders + final-video detect (backup)
        // =======================================================================
        else if (status === "review") {
          if (releaseDateCol !== -1 && taskEpUidCol !== -1 &&
              taskStatusCol !== -1 && taskWorkflowCol !== -1 &&
              taskIdCol !== -1 && taskDueDateCol !== -1) {
            _pulse_releaseReminders(
              epUid, guestName, contactId, epData[i][releaseDateCol],
              today, tomorrow, tasksData, tasksSheet,
              taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, agentName
            );
          }
          // Final-video backup detect (primary is the UI Complete button)
          const finalEpId = finalEpIdCol !== -1 ? String(epData[i][finalEpIdCol] || "") : "";
          if (!finalEpId && prodFolId) {
            const result = completeFinalEpisodeUpload(epUid); // no rowIndex
            if (result && result.ok) {
              logToAuditTrail(agentName, "state_change", epUid, contactId,
                "[INFO] Final-video detect: completeFinalEpisodeUpload succeeded for " + guestName + ".", "INFO");
            } else if (result && result.error && !result.error.includes("No file found")) {
              logToAuditTrail(agentName, "error", epUid, "",
                "[ERROR] Final-video detect failed for " + epUid + ": " + result.error, "ERROR");
            }
          }
        }

        // STAGE 4 (ready_to_release), 5 (live), 6 (archived): no pulse action

      } catch(epErr) {
        logToAuditTrail(agentName, "error", epUid, "",
          "[ERROR] Pulse threw for episode " + epUid + ": " + epErr.message, "ERROR");
        try {
          spawnTask({
            episodeUid:       epUid,
            workflowStep:     "Errors",
            actionTitle:      "Pulse error — " + guestName,
            assignee:         getGovernance("ASSIGNEE_PRODUCER"),
            assignedBy:       "The Fairy Team",
            status:           "open",
            priority:         "urgent",
            executiveSummary: "Daily Pulse threw an error for " + guestName + " (" + epUid + "): " + epErr.message + ". Check Audit_Trail."
          }, true);
        } catch(alertErr) {
          logToAuditTrail(agentName, "error", epUid, "",
            "[ERROR] Could not spawn alert task for " + epUid + ": " + alertErr.message, "ERROR");
        }
      }
    }

    // =========================================================================
    // STAGE 7: Purge sweep (system-level) — delete aged rejected assets (§4)
    // =========================================================================
    _pulse_purgeRejectedAssets(agentName);

    // =========================================================================
    // STAGE 8: Asset_ID uniqueness integrity check (Responsiveness spoke §5)
    // =========================================================================
    _pulse_checkAssetIdIntegrity(agentName);

    bumpVersion("tasks",    "dailyPulse");
    bumpVersion("episodes", "dailyPulse");
    logToAuditTrail(agentName, "human_action", "", "", "[INFO] Daily Pulse complete.", "INFO");

  } catch(e) {
    logToAuditTrail(agentName, "error", "", "", "[ERROR] Daily Pulse threw a fatal error: " + e.message, "ERROR");
  }
}

/**
 * SPOKE Asset Deletion §4 — purge sweep (system-level, once per pulse).
 * Permanently deletes Asset_Library rows with Status='rejected' whose episode's
 * Release_Date + 30 days < today. This is the one deletion path under the
 * otherwise-permanent Asset_Library (AD #99 exception, locked this session).
 * Rules:
 *   - Episodes without a Release_Date are never purged.
 *   - The Drive file is trashed BY Drive_File_ID — folder location is cosmetic
 *     (a non-fatal §1 move may have left the file outside Reels/Delete).
 *   - File trash is non-fatal; the row is still deleted so the sweep converges.
 *   - bumpVersion('asset_library') fires once if >=1 row is deleted.
 *   - Audit_Trail logs each purged row plus a sweep summary.
 * Self-contained (opens its own data) so it is callable from dev_tools.
 */
function _pulse_purgeRejectedAssets(agentName) {
  var PURGE_AFTER_DAYS = 30;
  try {
    var ss = SpreadsheetApp.openById(getMasterSheetId());

    // Build epUid -> Release_Date(ms or null) from Episodes (header-driven).
    var epSheet = ss.getSheetByName("Episodes");
    if (!epSheet) return;
    var epData = epSheet.getDataRange().getValues();
    if (!epData.length) return;
    var epHdr = epData[0];
    var eUidC = epHdr.indexOf("Episode_UID");
    var relC  = epHdr.indexOf("Release_Date");
    if (eUidC === -1 || relC === -1) return;

    var releaseMs = {};
    for (var e = 1; e < epData.length; e++) {
      var u = String(epData[e][eUidC] || "");
      if (!u) continue;
      var rv = epData[e][relC];
      var ms = null;
      if (rv instanceof Date && !isNaN(rv.getTime())) {
        ms = rv.getTime();
      } else if (rv && String(rv).trim() !== "") {
        var d = new Date(String(rv));
        if (!isNaN(d.getTime())) ms = d.getTime();
      }
      releaseMs[u] = ms;
    }

    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return;
    var alData = alSheet.getDataRange().getValues();

    var nowMs    = Date.now();
    var windowMs = PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    var toPurge  = []; // { rowNum, assetId, epUid, fileId }

    for (var r = 1; r < alData.length; r++) {
      if (String(alData[r][ASSET_LIBRARY_COLS.Status - 1] || "").toLowerCase() !== "rejected") continue;
      var epUid = String(alData[r][ASSET_LIBRARY_COLS.Episode_UID - 1] || "");
      var rel   = releaseMs[epUid];
      if (rel == null) continue;             // no Release_Date -> never purge
      if (rel + windowMs >= nowMs) continue; // still inside the 30-day window
      toPurge.push({
        rowNum:  r + 1,
        assetId: String(alData[r][ASSET_LIBRARY_COLS.Asset_ID      - 1] || ""),
        epUid:   epUid,
        fileId:  String(alData[r][ASSET_LIBRARY_COLS.Drive_File_ID - 1] || "")
      });
    }

    if (!toPurge.length) return;

    // Delete bottom-up so sheet row numbers stay valid; trash file by ID (non-fatal).
    for (var p = toPurge.length - 1; p >= 0; p--) {
      var item = toPurge[p];
      if (item.fileId) {
        try {
          DriveApp.getFileById(item.fileId).setTrashed(true);
        } catch (fe) {
          logToAuditTrail(agentName, "error", item.epUid, "",
            "[WARNING] Purge: could not trash file " + item.fileId +
            " for " + item.assetId + ": " + fe.message, "WARNING");
        }
      }
      alSheet.deleteRow(item.rowNum);
      logToAuditTrail(agentName, "state_change", item.epUid, "",
        "PURGED rejected asset: Asset_ID=" + item.assetId +
        " file=" + (item.fileId || "none"), "INFO");
    }

    bumpVersion("asset_library", "purgeRejectedAssets");
    logToAuditTrail(agentName, "state_change", "", "",
      "PURGE_SWEEP: " + toPurge.length + " rejected asset(s) deleted (Release_Date + " +
      PURGE_AFTER_DAYS + "d elapsed)", "INFO");

  } catch (e) {
    logToAuditTrail(agentName, "error", "", "",
      "[ERROR] Purge sweep failed: " + e.message, "ERROR");
  }
}

/**
 * Responsiveness/Polish spoke §5 — Asset_ID uniqueness integrity check.
 * Asset_ID is the Asset_Library primary key; ~20 lookup sites patch the first
 * matching row and are entitled to assume uniqueness (the 2026-06-10 collision
 * was hand-introduced data and misrouted a rejectAsset write). Detection only,
 * no auto-fix — data repair is Audra's.
 * Rules:
 *   - Duplicate Asset_ID values -> one WARNING audit line naming IDs + row numbers.
 *   - Spawns one urgent Data_Integrity task; idempotent — skips while any
 *     Data_Integrity task is open/in_progress (suppressBump: dailyPulse bumps tasks).
 *   - Never throws into the pulse; failures log as WARNING and return.
 * Self-contained (opens its own data) so it is callable from dev_tools.
 */
function _pulse_checkAssetIdIntegrity(agentName) {
  try {
    var ss      = SpreadsheetApp.openById(getMasterSheetId());
    var alName  = getGovernance("ASSET_LIBRARY_TAB_NAME") || "Asset_Library";
    var alSheet = ss.getSheetByName(alName);
    if (!alSheet) return;
    var data = alSheet.getDataRange().getValues();

    var seen = {}, dupes = {};
    for (var i = 1; i < data.length; i++) {
      var id = String(data[i][ASSET_LIBRARY_COLS.Asset_ID - 1] || "").trim();
      if (!id) continue;
      if (seen[id]) {
        if (!dupes[id]) dupes[id] = [seen[id]];
        dupes[id].push(i + 1);
      } else {
        seen[id] = i + 1;
      }
    }

    var ids = Object.keys(dupes);
    if (!ids.length) return;

    var detail = ids.map(function(id) {
      return id + " (rows " + dupes[id].join(", ") + ")";
    }).join("; ");

    logToAuditTrail(agentName, "error", "", "",
      "[WARNING] ASSET_ID_DUPLICATES: " + detail, "WARNING");

    // Idempotent spawn: one open Data_Integrity task at a time.
    var tSheet = ss.getSheetByName("Tasks");
    if (tSheet) {
      var tData   = tSheet.getDataRange().getValues();
      var th      = tData[0];
      var stepC   = th.indexOf("Workflow_Step");
      var statusC = th.indexOf("Status");
      if (stepC !== -1 && statusC !== -1) {
        for (var t = 1; t < tData.length; t++) {
          if (String(tData[t][stepC]) !== "Data_Integrity") continue;
          var tSt = String(tData[t][statusC]);
          if (tSt === "open" || tSt === "in_progress") return;
        }
      }
    }

    spawnTask({
      workflowStep:     "Data_Integrity",
      actionTitle:      "Duplicate Asset_IDs detected in Asset_Library",
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      executiveSummary: "Asset_Library has duplicate Asset_ID values: " + detail +
        ". Asset_ID is the primary key; lookups patch the first matching row, so " +
        "writes can land on the wrong row while duplicates exist. Repair by hand: " +
        "re-ID or delete the duplicate rows."
    }, true);
  } catch (e) {
    logToAuditTrail(agentName, "error", "", "",
      "[WARNING] Asset_ID integrity check failed: " + e.message, "WARNING");
  }
}


// =============================================================================
// DAILY PULSE — HELPER FUNCTIONS
// Private; prefixed _pulse_ to signal call site.
// =============================================================================

/**
 * Detects a finished transcript file in Episode/ subfolder.
 * Skips proxy_ files. Returns true if a .txt / Google Doc named "transcript" is found.
 */
function _pulse_detectTranscript(prodFolderId) {
  try {
    const stagingFolder = DriveApp.getFolderById(prodFolderId);
    const epFolderIt    = stagingFolder.getFoldersByName("Episode");
    if (!epFolderIt.hasNext()) return false;
    const epFolder = epFolderIt.next();
    const files    = epFolder.getFiles();
    while (files.hasNext()) {
      const f    = files.next();
      const name = f.getName().toLowerCase();
      const mime = f.getMimeType();
      if (name.startsWith("proxy_")) continue;
      if (name.includes("transcript") &&
          (mime === MimeType.PLAIN_TEXT || mime === MimeType.GOOGLE_DOCS || name.endsWith(".txt"))) {
        return true;
      }
    }
    return false;
  } catch(e) {
    return false;
  }
}

/**
 * Runs the content chain (A→B→C) for a single in_production episode.
 * Chained-within-pulse: advances all ready stages in one run.
 * Per-stage try/catch: failure stops the chain and spawns an alert task.
 *
 * heavyBudgetRemaining: how many more heavy Claude passes (Track A + B) this
 * run may fire. Track C (materializeQuoteGraphicAssets) is not counted and
 * always runs when its condition is met. Returns count of heavy passes fired.
 * When Track C is auto-triggered it will join the budget — note for that spoke.
 */
function _pulse_contentChain(epUid, guestName, prodFolderId, agentName, heavyBudgetRemaining) {
  if (String(getGovernance("PULSE_CONTENT_ENABLED") || "").toUpperCase() !== "TRUE") return 0;
  // §3 Expectation gate: no transcript + open Upload_Raw_Assets task → expected wait, skip quietly
  if (!_pulse_detectTranscript(prodFolderId)) {
    if (_pulse_hasOpenUploadRawTask(epUid)) {
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] No transcript for " + guestName + " — waiting on raw asset upload. Content chain skipped.", "INFO");
      return 0;
    }
  }
  let manifest = getManifest(prodFolderId);
  let heavyFired = 0;

  // Track A: no index → build it (heavy pass)
  if (!manifest || !manifest.episode_index_v2) {
    if (heavyBudgetRemaining <= 0) {
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Track A deferred — heavy-pass budget exhausted for " + guestName + ".", "INFO");
      return heavyFired;
    }
    try {
      buildEpisodeIndexV2(epUid, { force: false });
      heavyFired++;
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Track A complete for " + guestName + ".", "INFO");
    } catch(e) {
      logToAuditTrail(agentName, "error", epUid, "",
        "[ERROR] Track A failed for " + epUid + ": " + e.message, "ERROR");
      _pulse_spawnErrorTask(epUid, guestName, "Track A (buildEpisodeIndexV2)", e.message);
      return heavyFired;
    }
    manifest = getManifest(prodFolderId);
    if (!manifest || !manifest.episode_index_v2) return heavyFired;
  }

  // Track B: no show notes → editorial pass (heavy pass)
  if (!manifest.show_notes) {
    if (heavyBudgetRemaining - heavyFired <= 0) {
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Track B deferred — heavy-pass budget exhausted for " + guestName + ".", "INFO");
      return heavyFired;
    }
    try {
      runEditorialPass(epUid, { force: false });
      heavyFired++;
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Track B complete for " + guestName + ".", "INFO");
    } catch(e) {
      logToAuditTrail(agentName, "error", epUid, "",
        "[ERROR] Track B failed for " + epUid + ": " + e.message, "ERROR");
      _pulse_spawnErrorTask(epUid, guestName, "Track B (runEditorialPass)", e.message);
      return heavyFired;
    }
    manifest = getManifest(prodFolderId);
    if (!manifest || !manifest.show_notes) return heavyFired;
  }

  // Track C: show notes present, no quote graphics (not counted in heavy budget)
  if (!manifest.quote_graphic_assets_built) {
    try {
      materializeQuoteGraphicAssets(epUid, { force: false });
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Track C complete for " + guestName + ".", "INFO");
    } catch(e) {
      logToAuditTrail(agentName, "error", epUid, "",
        "[ERROR] Track C failed for " + epUid + ": " + e.message, "ERROR");
      _pulse_spawnErrorTask(epUid, guestName, "Track C (materializeQuoteGraphicAssets)", e.message);
    }
  }

  return heavyFired;
}

/**
 * Runs the reel chain for a single episode. syncReelAssets handles full analysis
 * (audio upload → Gemini dual-output → Reel_Transcript + Reel_Summary). Idempotent.
 */
function _pulse_reelChain(epUid, guestName, agentName) {
  if (String(getGovernance("PULSE_REELS_ENABLED") || "").toUpperCase() !== "TRUE") return;
  try {
    const result = syncReelAssets(epUid, { force: false });
    if (result && result.timedOut) {
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] syncReelAssets timed out for " + guestName + " — will resume next pulse.", "INFO");
    }
  } catch(e) {
    logToAuditTrail(agentName, "error", epUid, "",
      "[ERROR] syncReelAssets failed for " + epUid + ": " + e.message, "ERROR");
  }
}

/**
 * Spawns an Upload_Produced_Episode task if one does not already exist (open/in_progress).
 * Idempotent — safe to call every pulse while the episode is in_production.
 */
function _pulse_spawnUploadTask(epUid, guestName, contactId, tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol) {
  if (taskEpUidCol === -1 || taskStatusCol === -1 || taskWorkflowCol === -1) return;
  for (let t = 1; t < tasksData.length; t++) {
    if (tasksData[t][taskEpUidCol] !== epUid) continue;
    if (String(tasksData[t][taskWorkflowCol]) !== "Upload_Produced_Episode") continue;
    const s = String(tasksData[t][taskStatusCol]);
    if (s === "open" || s === "in_progress") return;
  }
  spawnTask({
    episodeUid:   epUid,
    contactId:    contactId,
    workflowStep: "Upload_Produced_Episode",
    actionTitle:  "Upload produced episode — " + guestName,
    assignee:     getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:   "The Fairy Team",
    status:       "open",
    priority:     "normal"
  });
}

/**
 * Spawns an Upload_Raw_Assets task on recording day.
 * Idempotent — one per episode: skips if any non-cancelled task already exists.
 */
function _pulse_spawnUploadRawTask(epUid, guestName, contactId, rawFolId,
    tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol, agentName) {
  if (taskEpUidCol !== -1 && taskStatusCol !== -1 && taskWorkflowCol !== -1) {
    for (var t = 1; t < tasksData.length; t++) {
      if (String(tasksData[t][taskEpUidCol])    !== epUid)               continue;
      if (String(tasksData[t][taskWorkflowCol]) !== "Upload_Raw_Assets") continue;
      if (String(tasksData[t][taskStatusCol])   !== "cancelled")         return;
    }
  }
  spawnTask({
    episodeUid:   epUid,
    contactId:    contactId,
    workflowStep: "Upload_Raw_Assets",
    actionTitle:  "Upload raw assets — " + guestName,
    assignee:     getGovernance("ASSIGNEE_PRODUCER"),
    assignedBy:   "The Fairy Team",
    status:       "open",
    priority:     "normal",
    payloadLink:  rawFolId ? "https://drive.google.com/drive/folders/" + rawFolId : ""
  });
}

/**
 * Marks the open Upload_Raw_Assets task for an episode complete.
 * Called when transcript-detect fires. Idempotent — skips silently if absent or already done.
 */
function _pulse_completeUploadRawTask(epUid, agentName) {
  try {
    var ss    = SpreadsheetApp.openById(getMasterSheetId());
    var sheet = ss.getSheetByName("Tasks");
    if (!sheet) return;
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var epUidC  = headers.indexOf("Episode_UID");
    var statusC = headers.indexOf("Status");
    var stepC   = headers.indexOf("Workflow_Step");
    var idC     = headers.indexOf("Task_ID");
    if (epUidC === -1 || statusC === -1 || stepC === -1 || idC === -1) return;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][epUidC]) !== epUid)              continue;
      if (String(data[i][stepC])  !== "Upload_Raw_Assets") continue;
      var st = String(data[i][statusC]);
      if (st !== "open" && st !== "in_progress")           continue;
      updateTaskStatus(String(data[i][idC]), "complete");
      logToAuditTrail(agentName, "state_change", epUid, "",
        "[INFO] Upload_Raw_Assets task auto-completed on transcript detect for " + epUid + ".", "INFO");
      return;
    }
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, "",
      "[WARNING] _pulse_completeUploadRawTask failed: " + e.message, "WARNING");
  }
}

/**
 * Returns true if an open or in_progress Upload_Raw_Assets task exists for the episode.
 * Used by the §3 expectation gate in _pulse_contentChain.
 */
function _pulse_hasOpenUploadRawTask(epUid) {
  try {
    var ss    = SpreadsheetApp.openById(getMasterSheetId());
    var sheet = ss.getSheetByName("Tasks");
    if (!sheet) return false;
    var data    = sheet.getDataRange().getValues();
    var headers = data[0];
    var epUidC  = headers.indexOf("Episode_UID");
    var statusC = headers.indexOf("Status");
    var stepC   = headers.indexOf("Workflow_Step");
    if (epUidC === -1 || statusC === -1 || stepC === -1) return false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][epUidC]) !== epUid)              continue;
      if (String(data[i][stepC])  !== "Upload_Raw_Assets") continue;
      var st = String(data[i][statusC]);
      if (st === "open" || st === "in_progress")           return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * Spawns an urgent Errors task to alert Audra of a content-chain failure.
 */
function _pulse_spawnErrorTask(epUid, guestName, stage, errorMsg) {
  var title = "Pipeline error: " + guestName + " — " + stage;
  try {
    // Idempotent spawn: one open Errors task per (episode, stage). Mirrors the
    // open-task guard in _pulse_checkAssetIdIntegrity / spawnReviseAssetTask.
    // Title encodes guestName + stage, so distinct stages each surface while a
    // persistent same-stage failure dedups across pulses.
    var ss     = SpreadsheetApp.openById(getMasterSheetId());
    var tSheet = ss.getSheetByName("Tasks");
    if (tSheet) {
      var tData   = tSheet.getDataRange().getValues();
      var th      = tData[0];
      var epC     = th.indexOf("Episode_UID");
      var stepC   = th.indexOf("Workflow_Step");
      var titleC  = th.indexOf("Action_Title");
      var statusC = th.indexOf("Status");
      if (epC !== -1 && stepC !== -1 && titleC !== -1 && statusC !== -1) {
        for (var t = 1; t < tData.length; t++) {
          if (String(tData[t][stepC])  !== "Errors")        continue;
          if (String(tData[t][epC])    !== String(epUid))   continue;
          if (String(tData[t][titleC]) !== title)           continue;
          var tSt = String(tData[t][statusC]);
          if (tSt === "open" || tSt === "in_progress") {
            logToAuditTrail("Daily_Pulse", "state_change", epUid, "",
              "[INFO] Error task already open for " + title + " — skipping spawn.", "INFO");
            return;
          }
        }
      }
    }

    spawnTask({
      episodeUid:       epUid,
      workflowStep:     "Errors",
      actionTitle:      title,
      assignee:         getGovernance("ASSIGNEE_PRODUCER"),
      assignedBy:       "The Fairy Team",
      status:           "open",
      priority:         "urgent",
      executiveSummary: stage + " threw an error for " + guestName + " (" + epUid + "): " + errorMsg + ". Check Audit_Trail."
    }, true);
  } catch(alertErr) {
    logToAuditTrail("Daily_Pulse", "error", epUid, "",
      "[ERROR] Could not spawn error task for " + epUid + ": " + alertErr.message, "ERROR");
  }
}

// Recording reminders demoted to projected cues — no task rows written.
// Rendered client-side by stGetEpCues() against Recording_Date on each read.
// Existing rows cleared by clearReminderRows().
function _pulse_recordingReminders(epUid, guestName, contactId, recordingDate,
    today, tomorrow, tasksData, tasksSheet,
    taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, agentName) {
}

// Release reminders demoted to projected cues — no task rows written.
// Rendered client-side by stGetEpCues() against Release_Date on each read.
// Existing rows cleared by clearReminderRows().
function _pulse_releaseReminders(epUid, guestName, contactId, releaseDate,
    today, tomorrow, tasksData, tasksSheet,
    taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, agentName) {
}

/**
 * One-time sweep: marks all open/in_progress reminder rows complete.
 * Safe — reminder tasks carry no payload. Idempotent; invoke via dev_tools.
 * Workflow_Step values targeted: Recording_Reminder, Release_Reminder, Runway, Release_Day.
 */
function clearReminderRows() {
  var REMINDER_STEPS = ['Recording_Reminder', 'Release_Reminder', 'Runway', 'Release_Day'];
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var sheet   = ss.getSheetByName('Tasks');
  if (!sheet) return { cleared: 0 };
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var wsCol   = headers.indexOf('Workflow_Step');
  var statCol = headers.indexOf('Status');
  if (wsCol === -1 || statCol === -1) return { cleared: 0 };

  var cleared = 0;
  for (var i = 1; i < data.length; i++) {
    var ws     = String(data[i][wsCol]);
    var status = String(data[i][statCol]);
    if (REMINDER_STEPS.indexOf(ws) === -1) continue;
    if (status === 'complete')              continue;
    sheet.getRange(i + 1, statCol + 1).setValue('complete');
    cleared++;
  }
  // #17 audit (2026-06-12): dev-tool, but it mutates Tasks - clients gating
  // on the tasks version must see the sweep.
  if (cleared > 0) bumpVersion('tasks', 'clearReminderRows');
  logToAuditTrail('clearReminderRows', 'state_change', '', '',
    '[INFO] Cleared ' + cleared + ' reminder task rows (Recording_Reminder / Release_Reminder).', 'INFO');
  return { cleared: cleared };
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