// =============================================================================
// housekeeping.gs — DWYP Operations Platform
// Maintenance runner. Called by fairy_circle.gs on a nightly schedule.
// Does not self-trigger — all entry points are called by fairy_circle.gs.
// Version: 1.0 | April 2026
// Author: Claude (Anthropic). Never edit directly in Apps Script or via Gemini.
//
// CURRENT RESPONSIBILITIES:
//   parsePipelineBlock() — reads the NotebookLM pipeline block from the raw
//     transcript file and writes raw_hooks, raw_quotes, and image_prompts
//     to the episode manifest.
//
// FUTURE:
//   Mending Fairy (AI-assisted repair tasks) will live here. Do not scaffold.
//
// CALLED BY:
//   fairy_circle.gs: triggerNightlyHousekeeping() → runHousekeeping()
//
// PIPELINE BLOCK FORMAT (expected in raw transcript file):
//   --- DWYP PIPELINE DATA ---
//   HOOKS:
//   1. Hook text [1]
//   ...
//   QUOTES:
//   1. "Quote text." — Speaker Name [2]
//   ...
//   IMAGE PROMPTS:
//   1. Full image prompt text.
//   ...
//   --- END PIPELINE DATA ---
//
// GOVERNANCE KEYS USED:
//   None — all folder lookups go through fairy_circle.gs utilities.
// =============================================================================


// =============================================================================
// PIPELINE BLOCK PARSER
// =============================================================================

/**
 * Reads the raw transcript file for an episode, locates the NotebookLM
 * pipeline block, parses HOOKS / QUOTES / IMAGE PROMPTS sections, and
 * writes raw_hooks, raw_quotes, and image_prompts to the episode manifest.
 *
 * Idempotency: skips entirely (logs INFO) if manifest already has raw_hooks
 * populated. Re-run is safe after clearing raw_hooks from the manifest.
 *
 * Light validation only — if content is found, it is written. Missing sections
 * log a WARNING but do not abort the run. No exceptions are thrown to the caller.
 *
 * @param {string} epUid - Episode_UID to process (e.g. "EP-260315-1430")
 */
function parsePipelineBlock(epUid) {
  const agentName = "Housekeeping";

  if (!epUid) {
    logToAuditTrail(agentName, "error", "", "", "[WARNING] parsePipelineBlock called without epUid. Skipping.", "WARNING");
    return;
  }

  logToAuditTrail(agentName, "state_change", epUid, "", "[INFO] parsePipelineBlock starting.", "INFO");

  // -------------------------------------------------------------------------
  // STEP 1: Idempotency check — read manifest via Production_Folder_ID
  // -------------------------------------------------------------------------
  const prodFolderId = getStagingFolderIdByUid(epUid);

  if (!prodFolderId) {
    logToAuditTrail(agentName, "error", epUid, "", "[WARNING] Production_Folder_ID not found — cannot check manifest or write results. Skipping.", "WARNING");
    return;
  }

  let manifest;
  try {
    manifest = getManifest(prodFolderId);
  } catch (e) {
    if (e.isManifestCorrupt) {
      logToAuditTrail(agentName, "error", epUid, "",
        `[ERROR] Manifest corrupt — parsePipelineBlock blocked to prevent data loss. Folder: ${prodFolderId}. ${e.message}`, "ERROR");
      spawnTask({
        episodeUid:       epUid,
        actionTitle:      "BLOCKED: Episode manifest corrupt — manual recovery required",
        assignee:         getGovernance("ASSIGNEE_PRODUCER"),
        assignedBy:       "The Fairy Team",
        status:           "open",
        priority:         "urgent",
        executiveSummary: `episode_manifest.json in folder ${prodFolderId} failed JSON.parse. parsePipelineBlock was blocked to prevent a corrupt manifest from being overwritten. Manually inspect and repair the manifest file, then re-run housekeeping or trigger parsePipelineBlock manually for episode ${epUid}.`
      });
    } else {
      logToAuditTrail(agentName, "error", epUid, "",
        `[ERROR] Could not read manifest — parsePipelineBlock skipped. ${e.message}`, "ERROR");
    }
    return;
  }

  // Per-section idempotency — only skip sections already populated.
  const needsHooks   = !manifest || !Array.isArray(manifest.raw_hooks)     || manifest.raw_hooks.length    === 0;
  const needsQuotes  = !manifest || !Array.isArray(manifest.raw_quotes)    || manifest.raw_quotes.length   === 0;
  const needsPrompts = !manifest || !Array.isArray(manifest.image_prompts) || manifest.image_prompts.length === 0;

  if (!needsHooks && !needsQuotes && !needsPrompts) {
    logToAuditTrail(agentName, "state_change", epUid, "", "[INFO] All three sections already populated in manifest. Skipping.", "INFO");
    return;
  }

  logToAuditTrail(agentName, "state_change", epUid, "",
    "[INFO] Sections to parse — hooks: " + needsHooks + ", quotes: " + needsQuotes + ", imagePrompts: " + needsPrompts + ".", "INFO");

  // -------------------------------------------------------------------------
  // STEP 2: Get Raw folder ID
  // -------------------------------------------------------------------------
  const rawFolderId = getRawFolderIdByUid(epUid);

  if (!rawFolderId) {
    logToAuditTrail(agentName, "error", epUid, "", "[WARNING] Raw_Folder_ID not found for episode. Cannot read transcript. Skipping.", "WARNING");
    return;
  }

  // -------------------------------------------------------------------------
  // STEP 3: Find and read transcript file from Raw folder
  // Matches any file whose name contains "transcript" (case-insensitive).
  // -------------------------------------------------------------------------
  let transcriptText = null;

  try {
    const folder = DriveApp.getFolderById(rawFolderId);
    const files  = folder.getFiles();

    while (files.hasNext()) {
      const file     = files.next();
      if (file.getName().toLowerCase().indexOf("transcript") !== -1) {
        const mimeType = file.getMimeType();
        if (mimeType === "application/vnd.google-apps.document") {
          transcriptText = DocumentApp.openById(file.getId()).getBody().getText();
        } else if (mimeType === "text/plain") {
          transcriptText = file.getBlob().getDataAsString();
        } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          transcriptText = file.getAs("text/plain").getDataAsString();
        } else {
          logToAuditTrail(agentName, "error", epUid, "", "[WARNING] Transcript file has unrecognised MIME type (" + mimeType + "). Cannot read. Skipping.", "WARNING");
        }
        break;
      }
    }
  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, "", `[WARNING] Could not read raw folder: ${e.message}. Skipping.`, "WARNING");
    return;
  }

  if (!transcriptText) {
    logToAuditTrail(agentName, "error", epUid, "", "[WARNING] No transcript file found in raw folder. Cannot parse pipeline block. Skipping.", "WARNING");
    return;
  }

  // -------------------------------------------------------------------------
  // STEP 4: Locate pipeline block by bounded markers.
  // Regex accepts hyphens, en-dashes, and em-dashes — Google Docs auto-correct
  // can convert "---" to an em-dash, so the literal string match is unreliable.
  // -------------------------------------------------------------------------
  const startMatch = transcriptText.match(/[-–—]+\s*DWYP PIPELINE DATA\s*[-–—]+/);
  const endMatch   = transcriptText.match(/[-–—]+\s*END PIPELINE DATA\s*[-–—]+/);

  if (!startMatch || !endMatch || endMatch.index <= startMatch.index) {
    logToAuditTrail(agentName, "error", epUid, "", "[WARNING] Pipeline data block not found in transcript. Nothing to parse. Skipping.", "WARNING");
    return;
  }

  const block = transcriptText.substring(startMatch.index + startMatch[0].length, endMatch.index).trim();

  // -------------------------------------------------------------------------
  // STEP 5: Parse sections by ALL CAPS headers — only for missing sections.
  // extractSectionFromProse() from fairy_circle.gs handles the header matching.
  // Log a WARNING for any needed section that comes back empty.
  // -------------------------------------------------------------------------
  const hooksText        = needsHooks   ? extractSectionFromProse(block, "HOOKS")         : null;
  const quotesText       = needsQuotes  ? extractSectionFromProse(block, "QUOTES")        : null;
  const imagePromptsText = needsPrompts ? extractSectionFromProse(block, "IMAGE PROMPTS") : null;

  if (needsHooks   && !hooksText)        logToAuditTrail(agentName, "error", epUid, "", "[WARNING] HOOKS section not found in pipeline block.", "WARNING");
  if (needsQuotes  && !quotesText)       logToAuditTrail(agentName, "error", epUid, "", "[WARNING] QUOTES section not found in pipeline block.", "WARNING");
  if (needsPrompts && !imagePromptsText) logToAuditTrail(agentName, "error", epUid, "", "[WARNING] IMAGE PROMPTS section not found in pipeline block.", "WARNING");

  const rawHooks     = needsHooks   ? parseHooksSection(hooksText)             : null;
  const rawQuotes    = needsQuotes  ? parseQuotesSection(quotesText)           : null;
  const imagePrompts = needsPrompts ? parseImagePromptsSection(imagePromptsText) : null;

  // -------------------------------------------------------------------------
  // STEP 6: Write to manifest — only include sections that were missing and
  // produced content. Skip entirely if all missing sections parsed empty.
  // -------------------------------------------------------------------------
  const patch = {};
  if (rawHooks     && rawHooks.length)     patch.raw_hooks     = rawHooks;
  if (rawQuotes    && rawQuotes.length)    patch.raw_quotes    = rawQuotes;
  if (imagePrompts && imagePrompts.length) patch.image_prompts = imagePrompts;

  if (!Object.keys(patch).length) {
    logToAuditTrail(agentName, "error", epUid, "", "[WARNING] All missing sections parsed as empty. Nothing written to manifest.", "WARNING");
    return;
  }

  patchManifest(prodFolderId, patch);

  logToAuditTrail(
    agentName,
    "state_change",
    epUid,
    "",
    "[INFO] parsePipelineBlock complete. Hooks: " + (rawHooks ? rawHooks.length : "skipped") + ". Quotes: " + (rawQuotes ? rawQuotes.length : "skipped") + ". Image prompts: " + (imagePrompts ? imagePrompts.length : "skipped") + ".",
    "INFO"
  );
}


// =============================================================================
// SECTION PARSERS (private — used only by parsePipelineBlock)
// =============================================================================

/**
 * Parses the HOOKS section of the pipeline block.
 * Strips numbered list markers and bracket citations.
 * Returns plain string array, up to 10 items.
 *
 * @param {string} sectionText - Content of the HOOKS section
 * @returns {string[]}
 */
function parseHooksSection(sectionText) {
  if (!sectionText) return [];

  return sectionText
    .split("\n")
    .map(function(line) {
      return line
        .replace(/^\d+[\.\)]\s*/, "")          // strip "1. " or "1) "
        .replace(/\[\d+(?:[,\s]*\d+)*\]/g, "") // strip [1] or [1, 2] citations
        .trim();
    })
    .filter(function(line) { return line.length > 0; })
    .slice(0, 10);
}

/**
 * Parses the QUOTES section of the pipeline block.
 * Strips numbered list markers and bracket citations.
 * Preserves em-dash attribution (e.g. "text" — Speaker Name).
 * Returns plain string array, up to 10 items.
 *
 * @param {string} sectionText - Content of the QUOTES section
 * @returns {string[]}
 */
function parseQuotesSection(sectionText) {
  if (!sectionText) return [];

  return sectionText
    .split("\n")
    .map(function(line) {
      return line
        .replace(/^\d+[\.\)]\s*/, "")          // strip "1. " or "1) "
        .replace(/\[\d+(?:[,\s]*\d+)*\]/g, "") // strip [1] or [1, 2] citations
        .trim();
    })
    .filter(function(line) { return line.length > 0; })
    .slice(0, 10);
}

/**
 * Parses the IMAGE PROMPTS section of the pipeline block.
 * Strips numbered list markers only. Preserves full prompt text.
 * Returns plain string array, up to 5 items.
 *
 * @param {string} sectionText - Content of the IMAGE PROMPTS section
 * @returns {string[]}
 */
function parseImagePromptsSection(sectionText) {
  if (!sectionText) return [];

  return sectionText
    .split("\n")
    .map(function(line) {
      return line
        .replace(/^\d+[\.\)]\s*/, "") // strip "1. " or "1) "
        .trim();
    })
    .filter(function(line) { return line.length > 0; })
    .slice(0, 5);
}


// =============================================================================
// NIGHTLY RUNNER
// =============================================================================

/**
 * Nightly entry function. Called by fairy_circle.gs: triggerNightlyHousekeeping().
 * Queries Episodes tab for all active episodes and calls parsePipelineBlock()
 * for each. Logs a summary of episodes processed and skipped to Audit Trail.
 */
function runHousekeeping() {
  const agentName = "Housekeeping";

  logToAuditTrail(agentName, "human_action", "", "", "[INFO] Housekeeping run starting.", "INFO");

  try {
    const scriptProps = PropertiesService.getScriptProperties();
    const sheetId     = getMasterSheetId();
    if (!sheetId) throw new Error("FATAL: MASTER_SHEET_ID not set in Script Properties.");

    const ss    = SpreadsheetApp.openById(sheetId);
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) {
      logToAuditTrail(agentName, "error", "", "", "[ERROR] Episodes tab not found. Housekeeping cannot run.", "ERROR");
      return;
    }

    const data    = sheet.getDataRange().getValues();
    const headers = data[0];
    const uidCol    = headers.indexOf("Episode_UID");
    const statusCol = headers.indexOf("Status");

    if (uidCol === -1 || statusCol === -1) {
      logToAuditTrail(agentName, "error", "", "", "[ERROR] Episode_UID or Status column not found in Episodes tab. Housekeeping cannot run.", "ERROR");
      return;
    }

    let processed = 0;
    let skipped   = 0;

    for (let i = 1; i < data.length; i++) {
      const epUid  = data[i][uidCol];
      const status = String(data[i][statusCol]);

      if (!epUid)              continue;
      if (status !== "active") { skipped++; continue; }

      try {
        parsePipelineBlock(epUid);
        processed++;
      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, "", `[ERROR] parsePipelineBlock threw for ${epUid}: ${e.message}`, "ERROR");
        skipped++;
      }
    }

    logToAuditTrail(
      agentName,
      "state_change",
      "",
      "",
      `[INFO] Housekeeping run complete. Active episodes processed: ${processed}. Skipped (non-active or error): ${skipped}.`,
      "INFO"
    );

  } catch (e) {
    logToAuditTrail(agentName, "error", "", "", `[ERROR] Housekeeping run threw a fatal error: ${e.message}`, "ERROR");
  }
}


// =============================================================================
// TEST ENTRY POINT
// =============================================================================

function testParsePipelineBlock() {
  parsePipelineBlock("EP-260423-1454");
}


// =============================================================================
// CORPUS SYNC (Vertex AI RAG Engine)
// =============================================================================
//
// DISABLED — 2026-05-01
//
// The Vertex AI RAG importRagFiles API returns 404 for the us-south1 region
// where the dwyp-rag corpus lives. Both v1 and v1beta1 endpoints were tried.
// us-central1 does support the import API but could not connect to Google Drive
// as a source. Manual import via GCP Console (Vertex AI → RAG Engine → corpus
// → Import files) works and is the current workaround.
//
// To revisit: check if Google has expanded importRagFiles support to us-south1,
// or if there is a service account / OAuth scope that unlocks Drive-sourced
// imports in us-central1. The code below is correct and ready to uncomment.
//
// GOVERNANCE KEYS USED (when active):
//   STUDIO_CORPUS_ID       — full Vertex AI RAG corpus resource name
//                            (projects/dwyp-rag/locations/us-south1/ragCorpora/...)
//   CORPUS_DRIVE_FOLDER_ID — Drive folder ID to watch for transcript files
// =============================================================================

/*

function onCorpusFolderChange(e) {
  const agentName = "Corpus_Sync";

  if (!e || !e.id) {
    logToAuditTrail(agentName, "error", "", "", "[WARNING] onCorpusFolderChange: no file ID in event. Skipping.", "WARNING");
    return;
  }

  const corpusFolderId = getGovernance("CORPUS_DRIVE_FOLDER_ID");
  if (!corpusFolderId) {
    logToAuditTrail(agentName, "error", "", "", "[ERROR] CORPUS_DRIVE_FOLDER_ID not set in Governance_Config.", "ERROR");
    return;
  }

  try {
    const file    = DriveApp.getFileById(e.id);
    const parents = file.getParents();
    let inCorpusFolder = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === corpusFolderId) { inCorpusFolder = true; break; }
    }

    if (!inCorpusFolder) return;

    logToAuditTrail(agentName, "state_change", "", "",
      `[INFO] Corpus folder change detected: "${file.getName()}" (${e.id}). Triggering RAG import.`, "INFO");

    importFileToRagCorpus(e.id, file.getName());

  } catch (err) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] onCorpusFolderChange failed: ${err.message}`, "ERROR");
  }
}


function syncCorpusFolder() {
  const agentName = "Corpus_Sync";
  logToAuditTrail(agentName, "human_action", "", "", "[INFO] syncCorpusFolder: full folder import starting.", "INFO");

  const corpusFolderId = getGovernance("CORPUS_DRIVE_FOLDER_ID");
  if (!corpusFolderId) {
    logToAuditTrail(agentName, "error", "", "", "[ERROR] CORPUS_DRIVE_FOLDER_ID not set in Governance_Config.", "ERROR");
    return;
  }

  try {
    importFolderToRagCorpus(corpusFolderId);
  } catch (err) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] syncCorpusFolder failed: ${err.message}`, "ERROR");
  }
}


function importFileToRagCorpus(fileId, fileName) {
  const agentName  = "Corpus_Sync";
  const corpusName = getGovernance("STUDIO_CORPUS_ID");
  if (!corpusName) throw new Error("STUDIO_CORPUS_ID not configured in Governance_Config.");

  const location = corpusName.split("/")[3];
  const url      = "https://" + location + "-aiplatform.googleapis.com/v1/" +
                   corpusName + ":importRagFiles";

  const payload = {
    import_rag_files_config: {
      google_drive_source: {
        resource_ids: [{ resource_id: fileId, resource_type: "GOOGLE_DRIVE_FILE" }]
      }
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    headers:            { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] RAG import failed for "${fileName || fileId}" (${code}): ${body}`, "ERROR");
    throw new Error(`RAG import returned ${code}: ${body}`);
  }

  const opName = JSON.parse(body).name || "started";
  logToAuditTrail(agentName, "state_change", "", "",
    `[INFO] RAG import triggered for "${fileName || fileId}". Operation: ${opName}.`, "INFO");
}


function importFolderToRagCorpus(folderId) {
  const agentName  = "Corpus_Sync";
  const corpusName = getGovernance("STUDIO_CORPUS_ID");
  if (!corpusName) throw new Error("STUDIO_CORPUS_ID not configured in Governance_Config.");

  const location = corpusName.split("/")[3];
  const url      = "https://" + location + "-aiplatform.googleapis.com/v1/" +
                   corpusName + ":importRagFiles";

  const payload = {
    import_rag_files_config: {
      google_drive_source: {
        resource_ids: [{ resource_id: folderId, resource_type: "GOOGLE_DRIVE_FOLDER" }]
      }
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    headers:            { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code !== 200) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] RAG folder import failed for folder ${folderId} (${code}): ${body}`, "ERROR");
    throw new Error(`RAG folder import returned ${code}: ${body}`);
  }

  const opName = JSON.parse(body).name || "started";
  logToAuditTrail(agentName, "state_change", "", "",
    `[INFO] RAG folder import triggered for ${folderId}. Operation: ${opName}.`, "INFO");
}


function installCorpusTrigger() {
  // GAS does not support programmatic Drive onChange triggers — those must be
  // wired manually via Extensions > Apps Script > Triggers (set handler to
  // onCorpusFolderChange, event source: From Drive, event type: onChange).
  // This function installs an hourly time-based trigger on syncCorpusFolder
  // as the automated path. For a ~20-file corpus the 1-hour cadence is fine.

  // Idempotent — remove any existing hourly corpus sync trigger first
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "syncCorpusFolder") ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger("syncCorpusFolder")
    .timeBased()
    .everyHours(1)
    .create();

  logToAuditTrail("Corpus_Sync", "state_change", "", "",
    "[INFO] Hourly time-based trigger installed for syncCorpusFolder.", "INFO");
}

*/
