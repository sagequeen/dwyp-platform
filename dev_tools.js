// =============================================================================
// DEV TOOLS — Manual Test Wrappers
// Never called by production code. Run manually from Apps Script menu.
// All functions prefixed test_*
// =============================================================================


function test_dailyPulse() {
  console.log("[test_dailyPulse] START");
  dailyPulse();
  console.log("[test_dailyPulse] END");
}


function test_checkCalendarForInterviews() {
  console.log("[test_checkCalendarForInterviews] START");
  checkCalendarForInterviews();
  console.log("[test_checkCalendarForInterviews] END");
}


function test_vertShowNotes() {
  const TEST_EP_UID = "EP-260504-0736"; // Dr. Meenakshi Aggarwal — replace with active UID if needed
  console.log("[test_vertShowNotes] START — " + TEST_EP_UID);
  runVertFairy(TEST_EP_UID);
  console.log("[test_vertShowNotes] END");
}


/**
 * Manual test wrapper for buildEpisodeIndexV2.
 * Usage: test_buildEpisodeIndexV2('EP-260430-1427', { force: true })
 */
function test_buildEpisodeIndexV2(epUid, opts) {
  epUid = epUid || 'EP-260504-0736'; // Dr. Meenakshi Aggarwal — replace with active UID if needed
  opts  = opts  || { force: true };
  const result = buildEpisodeIndexV2(epUid, opts);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


function test_extractPromptDiagnostic() {
  const templateId = getGovernance("MASTER_TEMPLATE_ID");
  const body = DocumentApp.openById(templateId).getBody();
  const text = body.getText();

  // Search for "Host Voice" anywhere, case-insensitive
  const idx = text.toLowerCase().indexOf("host voice");
  if (idx === -1) {
    Logger.log("[diag] 'host voice' not found anywhere in template text");
    return;
  }

  // Log the 30 chars before and after to see exactly what surrounds it
  const snippet = text.slice(Math.max(0, idx - 30), idx + 40);
  Logger.log("[diag] Found 'host voice' at index " + idx);
  Logger.log("[diag] Snippet: " + JSON.stringify(snippet));

  // Log char codes of the characters just before the phrase
  const before = text.slice(Math.max(0, idx - 5), idx);
  Logger.log("[diag] Char codes before 'host voice': " +
    before.split("").map(function(c) { return c.charCodeAt(0); }).join(", "));

  // Also check what extractPrompt's line-split sees for this line
  const lines = text.split("\n");
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().indexOf("host voice") !== -1) {
      var line = lines[i];
      Logger.log("[diag] Line " + i + ": " + JSON.stringify(line));
      Logger.log("[diag] line.trim(): " + JSON.stringify(line.trim()));
      Logger.log("[diag] isHeading: " + /^#+\s/.test(line.trim()));
      Logger.log("[diag] lineText: " + JSON.stringify(line.replace(/^#+\s*/, "").trim().toLowerCase()));
      break;
    }
  }
}


function test_extractPromptSmokeTest() {
  const keys = [
    "# Host Voice",
    "# Caption Mechanics",
    "# Show Philosophy",
    "# Pillars",
    "# Peer Shows"
  ];
  let allPassed = true;
  keys.forEach(function(key) {
    const result = extractPrompt(key);
    const status = result ? "OK (" + result.length + " chars)" : "EMPTY — key not matched";
    Logger.log("[smoke] " + key + " → " + status);
    if (!result) allPassed = false;
  });
  Logger.log("[smoke] Result: " + (allPassed ? "ALL PASS" : "FAILURES — check keys above"));
}


function test_artistFairy() {
  const TEST_EP_UID = "EP-260428-1928"; // Carrie Sipe — replace with active UID if needed
  console.log("[test_artistFairy] START — " + TEST_EP_UID);
  runArtistFairy(TEST_EP_UID);
  console.log("[test_artistFairy] END");
}


function test_exportSlidesToPng() {
  const DECK_ID = ""; // paste the presentation ID here before running
  if (!DECK_ID) throw new Error("test_exportSlidesToPng: set DECK_ID before running.");
  exportSlidesToPng(DECK_ID);
}


// test_syncCorpusFolder disabled — syncCorpusFolder is commented out (corpus sync blocked in us-south1)
// function test_syncCorpusFolder() { ... }



// =============================================================================
// PHASE 1.2 — Versions Endpoints
// Run from Apps Script editor. These hit staging (editor context routes there).
// =============================================================================

function test_getAllVersions() {
  var result = getAllVersions();
  var domains = Object.keys(result);
  console.log("[test_getAllVersions] Domains returned:", domains.length);
  console.log("[test_getAllVersions] Result:", JSON.stringify(result));
  if (domains.length === 11) {
    console.log("[test_getAllVersions] PASS — all 11 domains present.");
  } else {
    console.log("[test_getAllVersions] FAIL — expected 11 domains, got " + domains.length + ".");
  }
}


function test_getDomainVersion() {
  var tasks = getDomainVersion("tasks");
  console.log("[test_getDomainVersion] tasks:", tasks, "(type: " + typeof tasks + ")");
  if (typeof tasks === "number") {
    console.log("[test_getDomainVersion] tasks — PASS (number returned)");
  } else {
    console.log("[test_getDomainVersion] tasks — FAIL (expected number, got " + typeof tasks + ")");
  }

  var invalid = getDomainVersion("nonexistent_domain");
  console.log("[test_getDomainVersion] nonexistent_domain:", invalid, "(type: " + typeof invalid + ")");
  if (invalid === null || invalid === 0) {
    console.log("[test_getDomainVersion] nonexistent_domain — PASS (null or 0, no crash)");
  } else {
    console.log("[test_getDomainVersion] nonexistent_domain — FAIL (expected null or 0, got " + invalid + ")");
  }
}


function test_bumpVersion() {
  var before = getDomainVersion("tasks");
  console.log("[test_bumpVersion] tasks before:", before);
  var result = bumpVersion("tasks", "manual_test");
  console.log("[test_bumpVersion] bumpVersion returned:", result);
  var after = getDomainVersion("tasks");
  console.log("[test_bumpVersion] tasks after:", after);
  if (after === before + 1) {
    console.log("[test_bumpVersion] PASS — incremented by 1.");
  } else {
    console.log("[test_bumpVersion] FAIL — expected " + (before + 1) + ", got " + after + ".");
  }
}


// LockService stress test — 5 rapid bumps should increment by exactly 5.
// Race condition shows up as fewer than 5 increments.
function test_bumpVersionLockStress() {
  var before = getDomainVersion("tasks");
  console.log("[test_bumpVersionLockStress] tasks before:", before);
  for (var i = 0; i < 5; i++) {
    bumpVersion("tasks", "stress_" + (i + 1));
  }
  var after = getDomainVersion("tasks");
  console.log("[test_bumpVersionLockStress] tasks after:", after);
  console.log("[test_bumpVersionLockStress] Expected increment: 5. Actual:", (after - before));
  if (after - before === 5) {
    console.log("[test_bumpVersionLockStress] PASS — LockService holding.");
  } else {
    console.log("[test_bumpVersionLockStress] FAIL — race condition detected. Critical fix needed.");
  }
}


// Drive hybrid test — two-step.
// Step 1: run before dropping a file into IMAGE_BACKGROUND_LIBRARY_ID folder → baseline.
// Step 2: drop a file, then run again → version should have bumped.
function test_imageDriveHybrid() {
  var version = getDomainVersion("image_library");
  console.log("[test_imageDriveHybrid] image_library version:", version);
  console.log("[test_imageDriveHybrid] Run once for baseline. Drop a file into IMAGE_BACKGROUND_LIBRARY_ID folder. Run again — version should increment.");
}


// =============================================================================
// PHASE 1.3 — Retrofit spot checks (editor-testable items only)
// App UI tests (tasks, contacts, asset_library) run in the browser, not here.
// =============================================================================

// Verifies that writing to Audit_Trail bumps the audit_trail version stamp.
// Tests both the append and the bumpVersion("audit_trail") call in logToAuditTrail().
function test_auditTrailBump() {
  var before = getDomainVersion("audit_trail");
  console.log("[test_auditTrailBump] audit_trail before:", before);
  logToAuditTrail("test_auditTrailBump", "test", "", "", "[TEST] Phase 1.3 audit_trail bump verification.", "INFO");
  var after = getDomainVersion("audit_trail");
  console.log("[test_auditTrailBump] audit_trail after:", after);
  if (after > before) {
    console.log("[test_auditTrailBump] PASS — audit_trail version incremented.");
  } else {
    console.log("[test_auditTrailBump] FAIL — audit_trail version did not increment. Check logToAuditTrail() bumpVersion call.");
  }
}


// Directly tests writeVideoStatus() — bumps episodes domain.
// Replace EP_UID with the episode in the staging sheet.
function test_writeVideoStatus() {
  const EP_UID = "EP-260428-1928"; // Carrie Sipe — replace if needed
  var before = getDomainVersion("episodes");
  console.log("[test_writeVideoStatus] episodes before:", before);
  var result = writeVideoStatus(EP_UID, "approved");
  console.log("[test_writeVideoStatus] writeVideoStatus result:", JSON.stringify(result));
  var after = getDomainVersion("episodes");
  console.log("[test_writeVideoStatus] episodes after:", after);
  if (after > before) {
    console.log("[test_writeVideoStatus] PASS — episodes version incremented.");
  } else {
    console.log("[test_writeVideoStatus] FAIL — episodes version did not increment.");
  }
}


// Verifies bumpVersion skips logToAuditTrail when domain === "audit_trail" (recursion guard).
// Should complete without hanging or throwing. audit_trail version increments by exactly 1.
function test_auditTrailRecursionGuard() {
  var before = getDomainVersion("audit_trail");
  console.log("[test_auditTrailRecursionGuard] audit_trail before:", before);
  var result = bumpVersion("audit_trail", "recursion_guard_test");
  console.log("[test_auditTrailRecursionGuard] bumpVersion returned:", result);
  var after = getDomainVersion("audit_trail");
  console.log("[test_auditTrailRecursionGuard] audit_trail after:", after);
  if (after === before + 1) {
    console.log("[test_auditTrailRecursionGuard] PASS — bumped cleanly, no recursion.");
  } else {
    console.log("[test_auditTrailRecursionGuard] FAIL — unexpected result. Expected " + (before + 1) + ", got " + after + ".");
  }
}


// =============================================================================
// PHASE 1.4 + 1.5 — Version-Aware Loader + Dashboard Migration
// Run from Apps Script editor. All hit staging (editor context routes there).
// =============================================================================

// Verifies getDomainsBatch returns proper shape for all three active domains.
function test_getDomainsBatch() {
  var result = getDomainsBatch(['tasks', 'episodes', 'contacts']);
  var keys = Object.keys(result);
  console.log("[test_getDomainsBatch] Keys returned:", keys.join(', '));
  console.log("[test_getDomainsBatch] Tasks count:", (result.tasks ? result.tasks.length : 'null'));
  console.log("[test_getDomainsBatch] Episodes count:", (result.episodes ? result.episodes.length : 'null'));
  console.log("[test_getDomainsBatch] Contacts count:", (result.contacts ? result.contacts.length : 'null'));
  var pass = keys.indexOf('tasks') !== -1 && keys.indexOf('episodes') !== -1 && keys.indexOf('contacts') !== -1;
  console.log(pass ? "[test_getDomainsBatch] PASS — all three active domains present." :
                     "[test_getDomainsBatch] FAIL — one or more active domains missing.");
}


// Confirms per-domain failure isolation: known-good domain returns data,
// unknown domain is silently skipped (not in result keys).
function test_getDomainsBatchPartialFailure() {
  var result = getDomainsBatch(['tasks', 'nonexistent_domain']);
  var tasksOk = result.tasks !== null && result.tasks !== undefined;
  var badAbsent = result.nonexistent_domain === undefined;
  console.log("[test_getDomainsBatchPartialFailure] tasks present:", tasksOk);
  console.log("[test_getDomainsBatchPartialFailure] nonexistent_domain absent:", badAbsent);
  if (tasksOk && badAbsent) {
    console.log("[test_getDomainsBatchPartialFailure] PASS — good domain returned, unknown domain silently skipped.");
  } else {
    console.log("[test_getDomainsBatchPartialFailure] FAIL — unexpected result. tasksOk=" + tasksOk + " badAbsent=" + badAbsent);
  }
}


// Quick sanity check that getAllVersions() returns all 11 domains with numeric values.
function test_versionsShape() {
  var versions = getAllVersions();
  var expectedDomains = [
    'tasks', 'episodes', 'contacts', 'asset_library', 'image_library',
    'manifests', 'governance_config', 'brand_voice', 'playbook',
    'content_sensitivity', 'audit_trail'
  ];
  var allPresent = true;
  var allNumeric = true;
  expectedDomains.forEach(function(d) {
    var v = versions[d];
    var isNum = typeof v === 'number';
    console.log("[test_versionsShape] " + d + ": " + v + " (" + typeof v + ")" + (isNum ? "" : " ← FAIL"));
    if (v === undefined) allPresent = false;
    if (!isNum) allNumeric = false;
  });
  if (allPresent && allNumeric) {
    console.log("[test_versionsShape] PASS — all 11 domains present, all numeric.");
  } else {
    console.log("[test_versionsShape] FAIL — allPresent=" + allPresent + " allNumeric=" + allNumeric);
  }
}


// Instructions for Test 6 (getAllVersions failure fallback).
// Not automated — requires a temporary edit to getAllVersions().
function test_simulateGetAllVersionsFailure() {
  console.log("[test_simulateGetAllVersionsFailure] To simulate getAllVersions failure:");
  console.log("  1. In dwyp_app.js, temporarily replace getAllVersions() body with: throw new Error('Simulated failure');");
  console.log("  2. clasp push to staging.");
  console.log("  3. Open /dev URL, watch Network tab — should see fallback getDomainsBatch(['tasks','episodes','contacts']) call.");
  console.log("  4. Dashboard should still render (correctness > speed).");
  console.log("  5. Restore original getAllVersions() body and push again when done.");
}


// =============================================================================
// SETUP — One-time initialization helpers (not test wrappers)
// =============================================================================

// Populates the Versions tab with headers + initial domain rows.
// Idempotent — skips any domain row that already exists.
//
// NOTE: setup functions bypass getMasterSheetId() intentionally. In the Apps Script
// editor, ScriptApp.getService().getUrl() returns the /dev URL, so isStaging()
// returns true and getMasterSheetId() routes to staging. These functions use the
// sheet ID directly to target the correct environment regardless of editor context.
//
// Run setup_versionsTab() for production, setup_versionsTab_staging() for staging.
// Both sheets must have a Versions tab before running.

function setup_versionsTab() {
  var productionId = PropertiesService.getScriptProperties().getProperty('MASTER_SHEET_ID');
  if (!productionId) throw new Error("setup_versionsTab: MASTER_SHEET_ID not set in Script Properties.");
  _populateVersionsTab_(productionId);
}

function setup_versionsTab_staging() {
  var stagingId = getGovernance("STAGING_SHEET_ID");
  if (!stagingId) throw new Error("setup_versionsTab_staging: STAGING_SHEET_ID not found in Governance_Config.");
  _populateVersionsTab_(stagingId);
}

function _populateVersionsTab_(sheetId) {
  var DOMAINS = [
    "tasks", "episodes", "contacts", "asset_library", "image_library",
    "manifests", "governance_config", "brand_voice", "playbook",
    "content_sensitivity", "audit_trail"
  ];
  var HEADERS = ["Domain", "Version", "Last_Modified", "Modified_By"];

  var ss    = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName("Versions");
  if (!sheet) throw new Error("_populateVersionsTab_: Versions tab not found in sheet " + sheetId);

  var firstCell = sheet.getRange(1, 1).getValue();
  if (!firstCell) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    console.log("[_populateVersionsTab_] Headers written.");
  }

  var data = sheet.getDataRange().getValues();
  var existing = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) existing[data[i][0]] = true;
  }

  var now = new Date();
  var added = 0;
  DOMAINS.forEach(function(domain) {
    if (!existing[domain]) {
      sheet.appendRow([domain, 0, now, "system"]);
      added++;
    }
  });

  console.log("[_populateVersionsTab_] Done. Added " + added + " domain(s). Skipped " + Object.keys(existing).length + " existing.");
}


// Writes "Display_Text" header to Asset_Library col 21.
// Idempotent — skips if header already present.
// Run setup_displayTextColumn() for production, setup_displayTextColumn_staging() for staging.
// Both bypass getMasterSheetId() — see note on setup_versionsTab() above.

function setup_displayTextColumn() {
  var productionId = PropertiesService.getScriptProperties().getProperty('MASTER_SHEET_ID');
  if (!productionId) throw new Error("setup_displayTextColumn: MASTER_SHEET_ID not set in Script Properties.");
  _addDisplayTextHeader_(productionId);
}

function setup_displayTextColumn_staging() {
  var stagingId = getGovernance("STAGING_SHEET_ID");
  if (!stagingId) throw new Error("setup_displayTextColumn_staging: STAGING_SHEET_ID not found in Governance_Config.");
  _addDisplayTextHeader_(stagingId);
}

function _addDisplayTextHeader_(sheetId) {
  var ss     = SpreadsheetApp.openById(sheetId);
  var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
  var sheet  = ss.getSheetByName(alName);
  if (!sheet) throw new Error("_addDisplayTextHeader_: " + alName + " not found in sheet " + sheetId);
  var col = ASSET_LIBRARY_COLS.Display_Text; // 21
  var existing = sheet.getRange(1, col).getValue();
  if (existing === 'Display_Text') {
    console.log("[_addDisplayTextHeader_] Display_Text header already at col " + col + ". Skipping.");
    return;
  }
  sheet.getRange(1, col).setValue('Display_Text');
  console.log("[_addDisplayTextHeader_] Display_Text header written to col " + col + " of " + alName + " in sheet " + sheetId + ".");
}



// =============================================================================
// SCHEMA MIGRATION — One-time Quote_Text normalization
// Replaces curly quotes (U+2018/2019/201C/201D) with ASCII equivalents in
// every Asset_Library Quote_Text cell. Idempotent — only writes rows that
// actually contain curly quotes.
// Run migrate_quoteTextNormalize() for production,
// migrate_quoteTextNormalize_staging() for staging.
// Both bypass getMasterSheetId() — see note on setup_versionsTab() above.
// =============================================================================

function migrate_quoteTextNormalize() {
  var productionId = PropertiesService.getScriptProperties().getProperty('MASTER_SHEET_ID');
  if (!productionId) throw new Error("migrate_quoteTextNormalize: MASTER_SHEET_ID not set in Script Properties.");
  _runQuoteTextNormalize_(productionId);
}

function migrate_quoteTextNormalize_staging() {
  var stagingId = getGovernance("STAGING_SHEET_ID");
  if (!stagingId) throw new Error("migrate_quoteTextNormalize_staging: STAGING_SHEET_ID not found in Governance_Config.");
  _runQuoteTextNormalize_(stagingId);
}

function _runQuoteTextNormalize_(sheetId) {
  var ss     = SpreadsheetApp.openById(sheetId);
  var alName = getGovernance('ASSET_LIBRARY_TAB_NAME') || 'Asset_Library';
  var sheet  = ss.getSheetByName(alName);
  if (!sheet) throw new Error("_runQuoteTextNormalize_: " + alName + " not found in sheet " + sheetId);

  var data       = sheet.getDataRange().getValues();
  var normalized = 0;
  var skipped    = 0;

  for (var i = 1; i < data.length; i++) {
    var normType = String(data[i][ASSET_LIBRARY_COLS.Asset_Type - 1]).toLowerCase().replace(/[_ ]/g, '');
    if (normType !== 'quotegraphic') { skipped++; continue; }

    var current = String(data[i][ASSET_LIBRARY_COLS.Quote_Text - 1] || '');
    if (!current) { skipped++; continue; }

    var clean = normalizeQuoteText(current);
    if (clean === current) { skipped++; continue; }

    sheet.getRange(i + 1, ASSET_LIBRARY_COLS.Quote_Text).setValue(clean);
    normalized++;
  }

  if (normalized > 0) bumpVersion('asset_library', 'migrate_quoteTextNormalize');
  logToAuditTrail(
    'schema_migration',
    'schema_migration_quote_text_normalize',
    null,
    null,
    'Normalized curly quotes to ASCII in Asset_Library.Quote_Text. Rows updated: ' + normalized + '. Skipped: ' + skipped + '.',
    'INFO'
  );
  console.log("[_runQuoteTextNormalize_] Done. Normalized: " + normalized + ". Skipped: " + skipped + ".");
}


// =============================================================================
// TRACK B — Editorial Pass
// =============================================================================

/**
 * Manual test wrapper for runEditorialPass.
 * Usage: test_runEditorialPass('EP-260430-1427', { force: true })
 * Run from editor dropdown with no args to hit the default test episode.
 */
function test_runEditorialPass(epUid, opts) {
  epUid = epUid || 'EP-260430-1427'; // David Bedrick — Index v2 already built
  opts  = opts  || { force: true };
  const result = runEditorialPass(epUid, opts);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// TRACK C — Bridge
// =============================================================================

/**
 * Manual test wrapper for materializeQuoteGraphicAssets. No trigger registration.
 * Requires Track B to have run for this episode first (produces Show Notes Doc).
 * Update EP UID before running.
 */
function test_materializeQuoteGraphicAssets() {
  const result = materializeQuoteGraphicAssets('EP-260430-1427', { force: true });
  Logger.log(JSON.stringify(result, null, 2));
}

function test_runReelEditorialPass() {
  var epUid  = "EP-260430-1427"; // David Bedrick — replace at run time
  var result = runReelEditorialPass(epUid, { force: false });
  Logger.log(JSON.stringify(result, null, 2));
}

function test_runReelEditorialPass_force() {
  var epUid  = "EP-260430-1427"; // David Bedrick — replace at run time
  var result = runReelEditorialPass(epUid, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
}
