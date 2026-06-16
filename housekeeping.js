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
//   repairStagingSubfolders() — ensures the full Staging subfolder tree exists
//     for an episode. Idempotent; skips folders that already exist.
//   archiveLiveEpisodes() — sweeps Episodes for Status="live" where
//     Release_Date + 5 days ≤ today, calls runFilingFairy() for each.
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
  if (rawHooks     && rawHooks.length)     patch.raw_hooks     = rawHooks.map(normalizeQuoteText);
  if (rawQuotes    && rawQuotes.length)    patch.raw_quotes    = rawQuotes.map(normalizeQuoteText);
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
// STAGING FOLDER REPAIR
// =============================================================================

/**
 * Ensures the full Staging subfolder tree exists for an episode.
 * Creates only what is missing — existing folders are untouched.
 * Safe to run nightly; no-ops when the tree is already complete.
 *
 * Expected tree inside Staging:
 *   Episode/
 *   Images/  →  Approved/, Save/, Delete/
 *   Reels/   →  Approved/, Save/, Delete/
 *   Thumbnails/
 *
 * @param {string} epUid - Episode_UID to repair (e.g. "EP-260315-1430")
 */
function repairStagingSubfolders(epUid) {
  const agentName = "Housekeeping";

  if (!epUid) return;

  const stagingId = getStagingFolderIdByUid(epUid);
  if (!stagingId) {
    logToAuditTrail(agentName, "error", epUid, "",
      "[WARNING] repairStagingSubfolders: no staging folder found. Skipping.", "WARNING");
    return;
  }

  try {
    const staging = DriveApp.getFolderById(stagingId);

    function ensure(parent, name) {
      const it = parent.getFoldersByName(name);
      if (it.hasNext()) return it.next();
      logToAuditTrail(agentName, "state_change", epUid, "",
        `[INFO] repairStagingSubfolders: created missing subfolder "${name}".`, "INFO");
      return parent.createFolder(name);
    }

    ensure(staging, "Episode");
    ensure(staging, "Thumbnails");

    const images = ensure(staging, "Images");
    ensure(images, "Approved");
    ensure(images, "Save");
    ensure(images, "Delete");

    const reels = ensure(staging, "Reels");
    ensure(reels, "Approved");
    ensure(reels, "Save");
    ensure(reels, "Delete");

  } catch (e) {
    logToAuditTrail(agentName, "error", epUid, "",
      `[ERROR] repairStagingSubfolders failed: ${e.message}`, "ERROR");
  }
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
// EPISODE ARCHIVAL
// =============================================================================

/**
 * Sweeps Episodes tab for all rows where Status = "live" and
 * Release_Date + 5 days ≤ today, then calls runFilingFairy() for each.
 *
 * Tuesday release + 5 days = Sunday archive. Idempotent — episodes already
 * patched to "complete" by runFilingFairy are not matched by the status filter.
 */
function archiveLiveEpisodes() {
  const agentName = "Housekeeping";

  logToAuditTrail(agentName, "state_change", "", "",
    "[INFO] archiveLiveEpisodes: sweep starting.", "INFO");

  try {
    const ss    = SpreadsheetApp.openById(getMasterSheetId());
    const sheet = ss.getSheetByName("Episodes");
    if (!sheet) {
      logToAuditTrail(agentName, "error", "", "",
        "[ERROR] archiveLiveEpisodes: Episodes tab not found.", "ERROR");
      return;
    }

    const data           = sheet.getDataRange().getValues();
    const headers        = data[0];
    const uidCol         = headers.indexOf("Episode_UID");
    const statusCol      = headers.indexOf("Status");
    const releaseDateCol = headers.indexOf("Release_Date");

    if (uidCol === -1 || statusCol === -1 || releaseDateCol === -1) {
      logToAuditTrail(agentName, "error", "", "",
        "[ERROR] archiveLiveEpisodes: required column missing (Episode_UID, Status, or Release_Date).", "ERROR");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let archived = 0;
    let skipped  = 0;

    for (let i = 1; i < data.length; i++) {
      const epUid  = data[i][uidCol];
      const status = String(data[i][statusCol]);

      if (!epUid || status !== "live") { skipped++; continue; }

      const releaseDate = new Date(data[i][releaseDateCol]);
      if (isNaN(releaseDate.getTime())) { skipped++; continue; }

      releaseDate.setHours(0, 0, 0, 0);
      const archiveAfter = new Date(releaseDate.getTime() + 5 * 24 * 60 * 60 * 1000);

      if (archiveAfter > today) { skipped++; continue; }

      try {
        runFilingFairy(epUid);
        archived++;
      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, "",
          `[ERROR] archiveLiveEpisodes: runFilingFairy threw for ${epUid}: ${e.message}`, "ERROR");
        skipped++;
      }
    }

    logToAuditTrail(agentName, "state_change", "", "",
      `[INFO] archiveLiveEpisodes: sweep complete. Archived: ${archived}. Skipped: ${skipped}.`, "INFO");

  } catch (e) {
    logToAuditTrail(agentName, "error", "", "",
      `[ERROR] archiveLiveEpisodes threw a fatal error: ${e.message}`, "ERROR");
  }
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

      if (!epUid)                                                                                          continue;
      if (status !== "in_production" && status !== "ready_to_release" && status !== "live") { skipped++; continue; }

      try {
        parsePipelineBlock(epUid);
        repairStagingSubfolders(epUid);
        runMendingFairy(epUid, status);
        processed++;
      } catch (e) {
        logToAuditTrail(agentName, "error", epUid, "", `[ERROR] Housekeeping threw for ${epUid}: ${e.message}`, "ERROR");
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

    archiveLiveEpisodes();

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
// MENDING FAIRY
// =============================================================================
// Judgment-layer repair pass. Called from runHousekeeping() for each active
// episode (in_production | ready_to_release). Never mutates live or archived.
//
// V1 OPERATIONS:
//   I4 -- companion .txt regen (T1, additive)
//   I1 -- manifest/Episodes reconcile (T2, internal)
//   O1 -- guest bio enrich (T2, outbound, delegates to Herald) [gated by Governance_Config MEND_O1_GUESTBIO_ENABLED, default OFF]
//
// LEDGER (manifest.mend_ledger):
//   { [issueKey]: { attempts: N, lastAttempt: ISO, status: 'open'|'healed'|'task_spawned' } }
//   Backoff: after MEND_MAX_ATTEMPTS failed auto-attempts, escalate to spawnTask and stop.
//   Idempotent: skip any entry with status 'healed' or 'task_spawned'.
//
// AUDIT ACTOR: 'Mending'
//   state_change for fixes, error for unfixable/blocked.
// =============================================================================

var MEND_MAX_ATTEMPTS = 3;

// D12: nightly guest-bio-enrich sweep (O1) is gated by Governance_Config key
// MEND_O1_GUESTBIO_ENABLED (default OFF — set to TRUE to restore the nightly
// retry). Enrichment is otherwise human-triggered via the Contacts Enrich button.
// The op self-gates with a silent return when disabled; see _mend_O1_guestBioEnrich.

/**
 * Entry function. Called by runHousekeeping() after parsePipelineBlock() and
 * repairStagingSubfolders() for each active episode.
 *
 * Pre-release guard: only processes in_production and ready_to_release.
 * Fail-closed on manifest corrupt -- inherits parsePipelineBlock() pattern.
 *
 * @param {string} epUid   - Episode_UID
 * @param {string} status  - Episode Status (already read by caller, passed to avoid re-read)
 */
function runMendingFairy(epUid, status) {
  var ACTOR = 'Mending';

  // Pre-release guard
  if (status !== 'in_production' && status !== 'ready_to_release') return;

  logToAuditTrail(ACTOR, 'state_change', epUid, '',
    '[INFO] runMendingFairy starting.', 'INFO');

  // -- Resolve production folder and manifest -----------------------------------
  var prodFolderId = getStagingFolderIdByUid(epUid);
  if (!prodFolderId) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[WARN] Production_Folder_ID not found -- Mending skipped.', 'WARNING');
    return;
  }

  var manifest;
  try {
    manifest = getManifest(prodFolderId);
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      (e.isManifestCorrupt
        ? '[ERROR] Manifest corrupt -- Mending blocked to prevent data loss. '
        : '[ERROR] Cannot read manifest -- Mending skipped. ')
      + e.message, 'ERROR');
    return;
  }
  if (!manifest) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[WARN] Manifest not found -- Mending skipped.', 'WARNING');
    return;
  }

  // -- Load mend ledger (or empty object for first run) ------------------------
  var ledger = manifest.mend_ledger || {};

  // -- Contact lookup (read once here; passed to O1 to avoid duplicate reads) --
  var contactId = null;
  var contact   = null;
  try {
    contactId = getContactIdByEpisodeUid(epUid);
    if (contactId) contact = getContactById(contactId);
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[WARN] Contact lookup failed -- O1 will be skipped. ' + e.message, 'WARNING');
  }

  // -- Run v1 operations (each wrapped; one op failure does not abort others) --
  try { _mend_I4_txtRegen(epUid, prodFolderId, ledger); }
  catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '', '[ERROR] I4 threw: ' + e.message, 'ERROR');
  }

  try { _mend_I1_reconcile(epUid, prodFolderId, manifest, ledger); }
  catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '', '[ERROR] I1 threw: ' + e.message, 'ERROR');
  }

  if (contactId && contact) {
    try { _mend_O1_guestBioEnrich(epUid, contactId, contact, ledger); }
    catch (e) {
      logToAuditTrail(ACTOR, 'error', epUid, '', '[ERROR] O1 threw: ' + e.message, 'ERROR');
    }
  }

  // -- Persist updated ledger (single patchManifest at end of run) -------------
  try {
    patchManifest(prodFolderId, { mend_ledger: ledger });
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[ERROR] Failed to persist mend_ledger: ' + e.message, 'ERROR');
  }

  logToAuditTrail(ACTOR, 'state_change', epUid, '', '[INFO] runMendingFairy complete.', 'INFO');
}


// =============================================================================
// MENDING LEDGER HELPERS
// =============================================================================
//
// TWO-AXIS DESIGN (explicit):
//   Axis 1 -- backoff / attempt ceiling: _mendDecide() and _mendUpdate().
//             Answers: should we try again, or have we given up?
//   Axis 2 -- tier (T1/T2/T3) auto-vs-task logic: lives inside each op.
//             T1 (additive/reversible): always auto + log; no spawnTask
//               except as escalation after MEND_MAX_ATTEMPTS.
//             T2 (content regen): auto only when fill-when-absent or
//               provably system-authored; spawnTask when ambiguous/conflicting.
//             T3 (destructive/ambiguous): always spawnTask; no auto path.
//             The tier is a fixed property of each op, not a runtime
//             parameter -- each _mend_* function encodes its own tier logic.
// =============================================================================

/**
 * Returns the autonomy decision for an issue key:
 *   'skip'     -- already healed or task spawned; do nothing
 *   'escalate' -- hit attempt ceiling; caller should spawnTask and stop
 *   'run'      -- proceed with auto-attempt
 *
 * Only handles the backoff axis. Auto-vs-task tier logic lives in each op.
 */
function _mendDecide(ledger, key, maxAttempts) {
  var entry = ledger[key];
  if (!entry) return 'run';
  if (entry.status === 'healed' || entry.status === 'task_spawned') return 'skip';
  if ((entry.attempts || 0) >= maxAttempts) return 'escalate';
  return 'run';
}

/**
 * Mutates the in-memory ledger entry for key.
 * Ledger is persisted by a single patchManifest at the end of runMendingFairy.
 *
 * @param {Object}  ledger        - mutable ledger object from manifest
 * @param {string}  key           - issue key (e.g. 'I4:fileId', 'I1:guest_name')
 * @param {string}  status        - 'open' | 'healed' | 'task_spawned'
 * @param {boolean} bumpAttempts  - true to increment attempts counter
 */
function _mendUpdate(ledger, key, status, bumpAttempts) {
  if (!ledger[key]) ledger[key] = { attempts: 0, lastAttempt: '', status: 'open' };
  if (bumpAttempts) ledger[key].attempts = (ledger[key].attempts || 0) + 1;
  ledger[key].status      = status;
  ledger[key].lastAttempt = new Date().toISOString();
}


// =============================================================================
// I4 -- COMPANION .TXT REGEN (T1, additive)
// =============================================================================

/**
 * Scans Manual_Exports/ and its direct subfolders for PNG files missing a .txt
 * companion of the same base name. Regenerates the .txt from Asset_Library
 * Caption_Host. Fill-when-absent only -- never overwrites an existing .txt.
 *
 * Issue key: 'I4:{pngDriveFileId}' (stable across renames).
 * T1: auto + log. Escalates to spawnTask only after MEND_MAX_ATTEMPTS failures.
 */
function _mend_I4_txtRegen(epUid, prodFolderId, ledger) {
  var ACTOR = 'Mending';

  var stagingFolder;
  try {
    stagingFolder = DriveApp.getFolderById(prodFolderId);
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[I4] Cannot open staging folder: ' + e.message, 'ERROR');
    return;
  }

  var exportIt = stagingFolder.getFoldersByName('Manual_Exports');
  if (!exportIt.hasNext()) return; // no exports folder yet -- nothing to check

  var exportsFolder = exportIt.next();
  var captionMap    = _mend_I4_buildCaptionMap(epUid);

  // Collect folders to scan: exports root + all immediate subfolders
  // (Singles/, day-name folders, SWIPE/ -- fixed one-level structure)
  var foldersToScan = [exportsFolder];
  var subIt = exportsFolder.getFolders();
  while (subIt.hasNext()) foldersToScan.push(subIt.next());

  for (var fi = 0; fi < foldersToScan.length; fi++) {
    var folder = foldersToScan[fi];

    // Build .txt presence set for O(1) lookup
    var txtSet  = {};
    var txtIter = folder.getFilesByType('text/plain');
    while (txtIter.hasNext()) txtSet[txtIter.next().getName()] = true;

    var pngIter = folder.getFilesByType('image/png');
    while (pngIter.hasNext()) {
      var pngFile     = pngIter.next();
      var pngName     = pngFile.getName();
      var baseName    = pngName.slice(0, -4); // strip .png (safe: filtered by MIME type)
      var expectedTxt = baseName + '.txt';

      if (txtSet[expectedTxt]) continue; // companion already present

      var issueKey = 'I4:' + pngFile.getId();
      var dec      = _mendDecide(ledger, issueKey, MEND_MAX_ATTEMPTS);
      if (dec === 'skip') continue;

      logToAuditTrail(ACTOR, 'state_change', epUid, '',
        '[I4] Detected missing .txt companion for "' + pngName +
        '". Tier=T1 decision=' + dec + '.', 'INFO');

      if (dec === 'escalate') {
        // Re-check caption map at escalation time to produce an actionable reason.
        var escPureBase = baseName.replace(/-\d+$/, '');
        var escCaption  = captionMap[baseName] || captionMap[escPureBase] || '';
        var escReason   = escCaption
          ? 'Caption_Host was found but Drive writes failed ' + MEND_MAX_ATTEMPTS + ' times. ' +
            'Check Drive permissions for the Manual_Exports folder.'
          : 'PNG is present but no Caption_Host exists for it in Asset_Library -- ' +
            'the asset row may have been deleted. Verify whether the PNG should be ' +
            'kept; if so, re-export from the Schedule surface to regenerate the .txt.';
        spawnTask({
          episodeUid:       epUid,
          actionTitle:      'Mending: PNG missing .txt companion -- repair manually',
          assignee:         getGovernance('ASSIGNEE_PRODUCER'),
          assignedBy:       'The Fairy Team',
          status:           'open',
          priority:         'normal',
          executiveSummary: '[I4] PNG "' + pngName + '" in Manual_Exports for episode ' +
            epUid + ' is missing its .txt caption companion after ' +
            MEND_MAX_ATTEMPTS + ' nightly attempts. ' + escReason
        });
        logToAuditTrail(ACTOR, 'error', epUid, '',
          '[I4] Task spawned -- unresolvable .txt gap for "' + pngName + '". ' + escReason, 'WARNING');
        _mendUpdate(ledger, issueKey, 'task_spawned', false);
        continue;
      }

      // dec === 'run': look up caption and create .txt
      var pureBase = baseName.replace(/-\d+$/, ''); // strip -N duplicate suffix
      var caption  = captionMap[baseName] || captionMap[pureBase] || '';

      if (!caption) {
        logToAuditTrail(ACTOR, 'error', epUid, '',
          '[I4] No Caption_Host found for "' + pngName +
          '" in Asset_Library -- deferring (attempt ' +
          ((ledger[issueKey] ? ledger[issueKey].attempts : 0) + 1) + ').', 'WARNING');
        _mendUpdate(ledger, issueKey, 'open', true);
        continue;
      }

      try {
        folder.createFile(Utilities.newBlob(caption, 'text/plain', expectedTxt));
        logToAuditTrail(ACTOR, 'state_change', epUid, '',
          '[I4] Created "' + expectedTxt + '" from Caption_Host. Outcome: auto.', 'INFO');
        _mendUpdate(ledger, issueKey, 'healed', true);
      } catch (e) {
        logToAuditTrail(ACTOR, 'error', epUid, '',
          '[I4] Drive write failed for "' + expectedTxt + '": ' + e.message, 'ERROR');
        _mendUpdate(ledger, issueKey, 'open', true);
      }
    }
  }
}

/**
 * Builds a _safeFilename-keyed caption lookup for non-reel assets of this episode.
 * Used by _mend_I4_txtRegen to match PNG filenames back to Caption_Host values.
 * Skips reel rows (they export .mp4, not .png).
 */
function _mend_I4_buildCaptionMap(epUid) {
  var map = {};
  try {
    var ss    = SpreadsheetApp.openById(getMasterSheetId());
    var alTab = ss.getSheetByName(getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library');
    if (!alTab) return map;
    var rows = alTab.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][ASSET_LIBRARY_COLS.Episode_UID - 1]) !== epUid) continue;
      if (String(rows[i][ASSET_LIBRARY_COLS.Asset_Type  - 1]).toLowerCase() === 'reel') continue;
      var dn  = String(rows[i][ASSET_LIBRARY_COLS.Display_Name - 1] || '');
      var cap = String(rows[i][ASSET_LIBRARY_COLS.Caption_Host - 1] || '');
      if (dn && cap) {
        var safe = _safeFilename(dn);
        if (safe) map[safe] = cap;
      }
    }
  } catch (e) {
    logToAuditTrail('Mending', 'error', epUid, '',
      '[I4] Caption map build failed: ' + e.message, 'WARNING');
  }
  return map;
}


// =============================================================================
// I1 -- MANIFEST / EPISODES RECONCILE (T2, internal)
// =============================================================================

/**
 * Detects drift between the episode manifest and the Episodes row on a defined
 * field set, then takes the appropriate T2 action:
 *   fill-when-absent -- auto (one side empty, other populated)
 *   conflict         -- spawnTask immediately; never picks a winner
 *
 * Normalization: all values cast to string, trimmed. Comparison is case-sensitive.
 * Empty: normalized === ''.  Sentinels (non-empty strings) are treated as present.
 *
 * Conflict backoff: a conflict is not transient -- retrying won't resolve it.
 * Task is spawned on first detection, ledger marked task_spawned, skipped on all
 * subsequent runs. No 3-attempt cycle.
 *
 * Fill backoff: write failures may be transient. Uses MEND_MAX_ATTEMPTS before
 * escalating to a task (same pattern as I4).
 *
 * Ledger keys are per-field per-episode: 'I1:guest_name', 'I1:contact_id'.
 * A stuck conflict on one field does not gate the other.
 *
 * Reconciled fields (v1):
 *   manifest.guest_name <-> Episodes.Guest_Name
 *   manifest.contact_id <-> Episodes.Contact_ID
 */
function _mend_I1_reconcile(epUid, prodFolderId, manifest, ledger) {
  var ACTOR = 'Mending';

  var FIELDS = [
    { mk: 'guest_name', ek: 'Guest_Name' },
    { mk: 'contact_id', ek: 'Contact_ID' }
  ];

  var epRow;
  try {
    epRow = getEpisodeRow(epUid);
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, '',
      '[I1] getEpisodeRow failed: ' + e.message, 'ERROR');
    return;
  }
  if (!epRow) {
    logToAuditTrail(ACTOR, 'error', epUid, '', '[I1] Episode row not found.', 'WARNING');
    return;
  }

  for (var fi = 0; fi < FIELDS.length; fi++) {
    var mk  = FIELDS[fi].mk;
    var ek  = FIELDS[fi].ek;
    var key = 'I1:' + mk;

    var mVal = String(manifest[mk] || '').trim();
    var eVal = String(epRow[ek]   || '').trim();

    // Both empty -- nothing to reconcile
    if (!mVal && !eVal) continue;

    // Consistent -- if there was an open entry, heal it; either way skip
    if (mVal === eVal) {
      if (ledger[key] && ledger[key].status === 'open') {
        _mendUpdate(ledger, key, 'healed', false);
        logToAuditTrail(ACTOR, 'state_change', epUid, '',
          '[I1] Field "' + mk + '" now consistent -- healed.', 'INFO');
      }
      continue;
    }

    var dec = _mendDecide(ledger, key, MEND_MAX_ATTEMPTS);
    if (dec === 'skip') continue;

    // ---- Conflict path (both set, values differ) ----------------------------
    // Not transient: spawn task immediately, mark task_spawned, never retry.
    if (mVal && eVal) {
      spawnTask({
        episodeUid:       epUid,
        actionTitle:      'Mending: manifest/Episodes conflict -- ' + ek,
        assignee:         getGovernance('ASSIGNEE_PRODUCER'),
        assignedBy:       'The Fairy Team',
        status:           'open',
        priority:         'normal',
        executiveSummary: '[I1] Field "' + ek + '" has conflicting values: ' +
          'manifest ' + mk + '="' + mVal + '" vs Episodes ' + ek + '="' + eVal + '". ' +
          'Likely cause: post-intake rename or contact re-key. ' +
          'Correct the wrong value manually, then re-run housekeeping for episode ' +
          epUid + '. Mending will not pick a winner.'
      });
      logToAuditTrail(ACTOR, 'error', epUid, '',
        '[I1] Conflict on "' + mk + '": manifest="' + mVal + '" episodes="' + eVal +
        '". Task spawned -- will not retry.', 'WARNING');
      _mendUpdate(ledger, key, 'task_spawned', false);
      continue;
    }

    // ---- Fill-when-absent path (exactly one side empty) ---------------------
    // Transient write failures use MEND_MAX_ATTEMPTS backoff before escalation.
    var fillTarget = !mVal ? 'manifest' : 'episodes';
    var fillValue  = !mVal ? eVal : mVal;

    logToAuditTrail(ACTOR, 'state_change', epUid, '',
      '[I1] Fill-when-absent on "' + mk + '": ' + fillTarget + ' is empty, ' +
      'filling from ' + (!mVal ? 'Episodes' : 'manifest') +
      ' with "' + fillValue + '". Tier=T2 decision=' + dec + '.', 'INFO');

    if (dec === 'escalate') {
      spawnTask({
        episodeUid:       epUid,
        actionTitle:      'Mending: auto-fill failed for ' + ek + ' after ' + MEND_MAX_ATTEMPTS + ' attempts',
        assignee:         getGovernance('ASSIGNEE_PRODUCER'),
        assignedBy:       'The Fairy Team',
        status:           'open',
        priority:         'normal',
        executiveSummary: '[I1] Could not auto-fill "' + ek + '" for episode ' + epUid +
          ' after ' + MEND_MAX_ATTEMPTS + ' nightly attempts. ' +
          'The value to fill is "' + fillValue + '" (sourced from ' +
          (!mVal ? 'Episodes tab' : 'manifest') + '). Verify and fill manually.'
      });
      logToAuditTrail(ACTOR, 'error', epUid, '',
        '[I1] Escalation task spawned for fill failure on "' + mk + '".', 'WARNING');
      _mendUpdate(ledger, key, 'task_spawned', false);
      continue;
    }

    // dec === 'run': attempt the fill
    try {
      if (fillTarget === 'manifest') {
        var mPatch = {};
        mPatch[mk] = fillValue;
        patchManifest(prodFolderId, mPatch);
      } else {
        var ePatch = {};
        ePatch[ek] = fillValue;
        patchEpisodes(epUid, ePatch);
      }
      logToAuditTrail(ACTOR, 'state_change', epUid, '',
        '[I1] Filled ' + fillTarget + '["' + mk + '"] = "' + fillValue +
        '". Outcome: auto.', 'INFO');
      _mendUpdate(ledger, key, 'healed', true);
    } catch (e) {
      logToAuditTrail(ACTOR, 'error', epUid, '',
        '[I1] Fill failed for "' + mk + '" (attempt ' +
        ((ledger[key] ? ledger[key].attempts : 0) + 1) + '): ' + e.message, 'ERROR');
      _mendUpdate(ledger, key, 'open', true);
    }
  }
}


// =============================================================================
// O1 -- GUEST BIO ENRICH (T2, outbound, delegates to Herald)
// =============================================================================

/**
 * Re-triggers Herald bio enrichment for contacts with an empty
 * Bio_Summary. Fill-only -- never overwrites a populated bio.
 * Delegates to runHeraldBio(); never re-implements Herald logic.
 *
 * Ledger key: 'O1:{contactId}' -- per contact, not per episode. If the same
 * contact has two active episodes, the first episode's Herald run writes the bio;
 * the second episode reads the contact fresh at runMendingFairy start and sees
 * the bio already populated, so returns without a second Herald call.
 *
 * Identity check (simplified): contact must have Display_Name AND at least one
 * researchable signal (email, website, any social field). No signals -> spawnTask
 * immediately (not transient; backoff would not help). With signals, use
 * MEND_MAX_ATTEMPTS backoff for transient Herald / Gemini failures before
 * escalating to a task.
 */
function _mend_O1_guestBioEnrich(epUid, contactId, contact, ledger) {
  var ACTOR      = 'Mending';
  var contactKey = 'O1:' + contactId;

  // D12 — gated behind Governance_Config MEND_O1_GUESTBIO_ENABLED. Default OFF.
  // Silent return when disabled (mirrors PULSE_CONTENT_ENABLED) -- no per-episode noise.
  if (String(getGovernance('MEND_O1_GUESTBIO_ENABLED') || '').toUpperCase() !== 'TRUE') return;

  var dec = _mendDecide(ledger, contactKey, MEND_MAX_ATTEMPTS);
  if (dec === 'skip') return;

  var bio         = String(contact.Bio_Summary || '').trim();
  var displayName = String(contact.Display_Name || '').trim();

  // Fill-only: bio already present -- nothing to do (Bio_Summary is content-or-blank, D12)
  if (bio) return;

  logToAuditTrail(ACTOR, 'state_change', epUid, contactId,
    '[O1] Empty/pending bio for ' + (displayName || contactId) +
    '. Tier=T2 decision=' + dec + '.', 'INFO');

  // Identity signal check: Herald needs at least a name + one research lead
  var hasName   = !!displayName;
  var hasSignal = !!(
    String(contact.Email            || '').trim() ||
    String(contact.Website          || '').trim() ||
    String(contact.Social_Instagram || '').trim() ||
    String(contact.Social_X         || '').trim() ||
    String(contact.Social_LinkedIn  || '').trim() ||
    String(contact.Social_YouTube   || '').trim() ||
    String(contact.Social_Podcast   || '').trim() ||
    String(contact.Social_Other     || '').trim()
  );

  // No signals: identity unconfirmed -- not transient, spawn task and stop
  if (!hasName || !hasSignal) {
    spawnTask({
      episodeUid:       epUid,
      contactId:        contactId,
      actionTitle:      'Mending: guest bio empty -- add contact signals to enable research',
      assignee:         getGovernance('ASSIGNEE_PRODUCER'),
      assignedBy:       'The Fairy Team',
      status:           'open',
      priority:         'normal',
      executiveSummary: '[O1] Contact ' + (displayName || contactId) +
        ' has an empty Bio_Summary and no researchable signals ' +
        '(no email, website, or social handles on the contact record). ' +
        'Add at least one signal, then run Herald from the Fairy Remote Control ' +
        'or wait for the nightly Mending pass.'
    });
    logToAuditTrail(ACTOR, 'error', epUid, contactId,
      '[O1] No research signals for ' + (displayName || contactId) +
      ' -- task spawned, will not retry.', 'WARNING');
    _mendUpdate(ledger, contactKey, 'task_spawned', false);
    return;
  }

  // Herald has failed MEND_MAX_ATTEMPTS times -- escalate
  if (dec === 'escalate') {
    spawnTask({
      episodeUid:       epUid,
      contactId:        contactId,
      actionTitle:      'Mending: Herald bio failed after ' + MEND_MAX_ATTEMPTS +
        ' attempts -- ' + (displayName || contactId),
      assignee:         getGovernance('ASSIGNEE_PRODUCER'),
      assignedBy:       'The Fairy Team',
      status:           'open',
      priority:         'normal',
      executiveSummary: '[O1] Herald bio enrichment for ' + (displayName || contactId) +
        ' (episode ' + epUid + ') did not produce a bio after ' +
        MEND_MAX_ATTEMPTS + ' nightly attempts. ' +
        'Contact has researchable signals so Herald should be able to proceed -- ' +
        'run Herald manually from the Fairy Remote Control to investigate.'
    });
    logToAuditTrail(ACTOR, 'error', epUid, contactId,
      '[O1] Escalation task spawned after ' + MEND_MAX_ATTEMPTS +
      ' failed Herald attempts for ' + (displayName || contactId) + '.', 'WARNING');
    _mendUpdate(ledger, contactKey, 'task_spawned', false);
    return;
  }

  // dec === 'run': delegate to Herald bio entry point
  var attemptNum = (ledger[contactKey] ? ledger[contactKey].attempts : 0) + 1;
  try {
    runHeraldBio(contactId);

    // Verify: re-read contact to confirm bio was actually written
    var updated = getContactById(contactId);
    var newBio  = String((updated && updated.Bio_Summary) || '').trim();

    if (newBio) {
      logToAuditTrail(ACTOR, 'state_change', epUid, contactId,
        '[O1] Bio enriched for ' + (displayName || contactId) + '. Outcome: auto.', 'INFO');
      _mendUpdate(ledger, contactKey, 'healed', true);
    } else {
      logToAuditTrail(ACTOR, 'error', epUid, contactId,
        '[O1] Herald ran but bio still empty/pending (attempt ' + attemptNum + ').', 'WARNING');
      _mendUpdate(ledger, contactKey, 'open', true);
    }
  } catch (e) {
    logToAuditTrail(ACTOR, 'error', epUid, contactId,
      '[O1] runHeraldBio threw (attempt ' + attemptNum + '): ' + e.message, 'ERROR');
    _mendUpdate(ledger, contactKey, 'open', true);
  }
}


// =============================================================================
// CORPUS SYNC (Vertex AI RAG Engine)
// =============================================================================
//
// DISABLED — 2026-05-01
//
// us-south1 is the locked, working region for this corpus and all associated GCS buckets.
// The Vertex AI RAG importRagFiles API returns 404 in us-south1 (both v1 and v1beta1).
// us-central1 supports the import API but cannot connect to Google Drive as a source.
// Do not route calls to us-central1 — Drive-sourced imports do not work there.
// Manual import via GCP Console (Vertex AI → RAG Engine → corpus → Import files)
// is the current workaround.
//
// To revisit: check if Google has expanded importRagFiles support to us-south1,
// or if there is a service account / OAuth scope that unlocks Drive-sourced imports.
// The code below is correct for us-south1 and ready to uncomment.
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
