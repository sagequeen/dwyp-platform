// =============================================================================
// DEV TOOLS — Manual Test Wrappers
// Never called by production code. Run from the Apps Script editor dropdown.
//
// USAGE: Paste the active episode UID into ACTIVE_EP_UID, then run any function.
//        System-level functions (dailyPulse, calendar) ignore the UID.
//
// ORDER: Lifecycle order (Stage 0 → 6), then REELS REVISION, then SYSTEM-LEVEL.
// =============================================================================

var ACTIVE_EP_UID = 'EP-260430-1505'; // ← paste UID here before running


// =============================================================================
// DIAGNOSTICS — Run anytime; no episode UID required
// =============================================================================

// Logs the scopes actually present in the current OAuth token.
function test_checkTokenScopes() {
  var token = ScriptApp.getOAuthToken();
  var resp  = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?access_token=' + token,
    { muteHttpExceptions: true }
  );
  Logger.log('Status: ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}

// Logs the exact GCS_SIGNER_SA value from Governance_Config and attempts a
// raw signBlob call so we can see the full error if it fails.
function test_checkSignerSa() {
  var sa  = getGovernance('GCS_SIGNER_SA');
  var bkt = getGovernance('REVIEW_GCS_BUCKET');
  Logger.log('GCS_SIGNER_SA  = [' + sa + ']');
  Logger.log('REVIEW_GCS_BUCKET = [' + bkt + ']');
  if (!sa) { Logger.log('ERROR: GCS_SIGNER_SA is blank'); return; }

  var iamUrl  = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
                encodeURIComponent(sa) + ':signBlob';
  Logger.log('IAM URL = ' + iamUrl);

  var resp = UrlFetchApp.fetch(iamUrl, {
    method:      'post',
    contentType: 'application/json',
    headers:     { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload:     JSON.stringify({ payload: Utilities.base64Encode('test') }),
    muteHttpExceptions: true
  });
  Logger.log('signBlob status: ' + resp.getResponseCode());
  Logger.log(resp.getContentText());
}

// Read-only. Inspects revision cycle-state for ACTIVE_EP_UID. Answers three things:
//   1) Do the two folder resolvers agree? Set (finalize) + read (getEpisodeRevisionHistory)
//      use EPISODES_COLS.Production_Folder_ID (hardcoded); clear (completeEpisodeRevision)
//      uses getStagingFolderIdByUid (headers.indexOf). If they differ, the clear lands on a
//      different manifest than the read -> composer stays locked no matter the routing.
//   2) What the manifest actually holds (revision_cycle / revision_finalized).
//   3) What the UI read returns (phase / finalized / cycle).
function test_inspectRevisionState() {
  var uid = ACTIVE_EP_UID;
  Logger.log('[inspectRevisionState] UID = ' + uid);

  var folderIndexOf = getStagingFolderIdByUid(uid); // headers.indexOf resolver
  var ss   = SpreadsheetApp.openById(getMasterSheetId());
  var data = ss.getSheetByName('Episodes').getDataRange().getValues();
  var folderHardcoded = '';
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][EPISODES_COLS.Episode_UID - 1]) === String(uid)) {
      folderHardcoded = String(data[i][EPISODES_COLS.Production_Folder_ID - 1] || '');
      break;
    }
  }
  Logger.log('  folder via getStagingFolderIdByUid (indexOf)            = [' + folderIndexOf + ']');
  Logger.log('  folder via EPISODES_COLS.Production_Folder_ID=' + EPISODES_COLS.Production_Folder_ID + ' (hardcoded) = [' + folderHardcoded + ']');
  Logger.log('  RESOLVERS MATCH = ' + (String(folderIndexOf) === String(folderHardcoded)));

  var m = getManifest(folderIndexOf);
  Logger.log('  manifest.revision_cycle     = ' + (m && m.revision_cycle));
  Logger.log('  manifest.revision_finalized = ' + (m && m.revision_finalized));
  Logger.log('  _readRevisionCycleState = ' + JSON.stringify(_readRevisionCycleState(folderIndexOf)));

  var hist = getEpisodeRevisionHistory(uid);
  Logger.log('  getEpisodeRevisionHistory.phase=' + (hist && hist.phase) +
             ' finalized=' + (hist && hist.finalized) + ' cycle=' + (hist && hist.cycle));
}

// Unwedge: clears the stuck revision_finalized flag for ACTIVE_EP_UID so the host's
// composer unlocks and a fresh revise round can be tested. Leaves the cycle as-is.
// Run test_inspectRevisionState first to capture the before-state.
function test_clearRevisionFinalized() {
  var uid = ACTIVE_EP_UID;
  var folderId = getStagingFolderIdByUid(uid);
  if (!folderId) { Logger.log('[clearRevisionFinalized] No folder for ' + uid + ' -- aborting.'); return; }
  var before = getManifest(folderId);
  Logger.log('[clearRevisionFinalized] before: finalized=' + (before && before.revision_finalized) +
             ' cycle=' + (before && before.revision_cycle));
  patchManifest(folderId, { revision_finalized: false });
  var after = getManifest(folderId);
  Logger.log('[clearRevisionFinalized] after:  finalized=' + (after && after.revision_finalized) +
             ' cycle=' + (after && after.revision_cycle));
  Logger.log('[clearRevisionFinalized] Done. Host composer should unlock on next episode load.');
}


// =============================================================================
// STAGE 0 — Intake (calendar scan → Secretary + Herald)
// =============================================================================

function test_checkCalendarForInterviews() {
  console.log("[test_checkCalendarForInterviews] START");
  checkCalendarForInterviews();
  console.log("[test_checkCalendarForInterviews] END");
}


// =============================================================================
// STAGE 1 — Transcript → Index (Track A)
// =============================================================================

// Track A: Episode Index v2 (Claude, extract-not-interpret posture)
// force: true trashes any existing v2 doc and rebuilds from scratch
function test_buildEpisodeIndexV2() {
  var result = buildEpisodeIndexV2(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// STAGE 2 — Index → Show Notes (Track B)
// =============================================================================

// Track B: Editorial Pass — requires Index v2 to exist first
function test_runEditorialPass() {
  var result = runEditorialPass(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// STAGE 3 — Show Notes → Quote Graphics (Track C)
// =============================================================================

// Track C: Materialize quote graphic assets — requires Track B Show Notes Doc
function test_materializeQuoteGraphicAssets() {
  var result = materializeQuoteGraphicAssets(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// STAGE 4 — Reels (sync + Gemini dual-output)
// syncReelAssets handles the full pipeline: audio upload → Gemini → Reel_Transcript (col 8) + Reel_Summary (col 9).
// If result.timedOut is true, re-run — it picks up where it left off.
// =============================================================================

function test_syncReelAssets() {
  var result = syncReelAssets(ACTIVE_EP_UID, { force: false });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// STAGE 5 — Visual Export
// =============================================================================

// Exports slides to PNG. Paste the presentation ID before running.
function test_exportSlidesToPng() {
  var DECK_ID = ''; // ← paste presentation ID here
  if (!DECK_ID) throw new Error("test_exportSlidesToPng: set DECK_ID before running.");
  exportSlidesToPng(DECK_ID);
}


// =============================================================================
// STAGE 6 — Episode Upload
// =============================================================================

// Spawns an Upload_Produced_Episode task for the active episode.
// Set ACTIVE_EP_UID to the episode's UID, then run once from the editor dropdown.
function test_spawnUploadEpisodeTask() {
  var sheetId = getMasterSheetId();
  var ss      = SpreadsheetApp.openById(sheetId);
  var epData  = ss.getSheetByName('Episodes').getDataRange().getValues();
  var guestName = ACTIVE_EP_UID, contactId = '';
  for (var i = 1; i < epData.length; i++) {
    if (String(epData[i][EPISODES_COLS.Episode_UID - 1]) !== String(ACTIVE_EP_UID)) continue;
    guestName = String(epData[i][EPISODES_COLS.Guest_Name - 1] || ACTIVE_EP_UID);
    contactId = String(epData[i][EPISODES_COLS.Contact_ID - 1] || '');
    break;
  }
  var result = spawnTask({
    episodeUid:       ACTIVE_EP_UID,
    contactId:        contactId,
    workflowStep:     'Upload_Produced_Episode',
    actionTitle:      'Upload produced episode — ' + guestName,
    assignee:         getGovernance('ASSIGNEE_PRODUCER'),
    assignedBy:       'The Fairy Team',
    status:           'open',
    priority:         'normal',
    executiveSummary: 'Export from Vids is ready. Upload the proxy MP4 for ' + guestName + ' to send it to review.'
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// REELS REVISION — Dormant surface; kept for manual close
// =============================================================================

// Atomic close after Audra uploads a revised reel.
// Paste the Asset_Library Asset_ID and the new Drive file ID, then run.
// After this completes, the next Pulse will spawn a fresh Review_Reels for JT.
function test_closeReelRevision() {
  var ASSET_ID       = ''; // ← paste Asset_Library Asset_ID here
  var NEW_DRIVE_FILE = ''; // ← paste Drive file ID of revised reel here
  if (!ASSET_ID || !NEW_DRIVE_FILE) throw new Error('Set ASSET_ID and NEW_DRIVE_FILE before running.');
  var result = closeReelRevision(ACTIVE_EP_UID, ASSET_ID, NEW_DRIVE_FILE);
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// SYSTEM-LEVEL
// =============================================================================

function test_dailyPulse() {
  console.log("[test_dailyPulse] START");
  dailyPulse();
  console.log("[test_dailyPulse] END");
}

// SPOKE Asset Deletion §4 — runs the purge sweep in isolation (DESTRUCTIVE).
// Deletes Asset_Library rejected rows whose episode Release_Date + 30d has passed,
// and trashes their Drive files. No episode UID needed (system-level sweep).
// Check Audit_Trail for PURGED / PURGE_SWEEP lines after running.
function test_purgeRejectedAssets() {
  console.log("[test_purgeRejectedAssets] START");
  _pulse_purgeRejectedAssets("Daily_Pulse_TEST");
  console.log("[test_purgeRejectedAssets] END");
}

// Scans Asset_Library for duplicate Asset_ID values (primary-key integrity).
// Detection only — logs ASSET_ID_DUPLICATES warning + spawns one urgent
// Data_Integrity task (idempotent while one is open). No data is modified.
function test_checkAssetIdIntegrity() {
  console.log("[test_checkAssetIdIntegrity] START");
  _pulse_checkAssetIdIntegrity("Daily_Pulse_TEST");
  console.log("[test_checkAssetIdIntegrity] END");
}


// =============================================================================
// PULSE HARNESS — Single-episode end-to-end validation
//
// Runs the Pulse stage(s) appropriate to one episode's current Status.
// Calls the actual _pulse_* helpers — never reimplements spawn/pass logic.
// Safe to re-run: inherits real Pulse idempotency by wrapping it.
//
// Stage 0 (Calendar intake) is skipped — system-level; no per-episode scope.
// Use test_checkCalendarForInterviews() for Stage 0 validation.
//
// Flag overrides: harness writes sentinel Script Properties (_DEV_OVERRIDE_<key>)
// and clears them in a finally block. Per-invocation only, never persisted.
// Requires the _DEV_OVERRIDE sentinel path active in getGovernance() to work.
// Default (no flagOverrides arg): reads real flags from Governance_Config.
//
// Usage:
//   test_pulseOneEpisode('EP-260423-1454')
//   test_pulseOneEpisode('EP-260423-1454', { PULSE_CONTENT_ENABLED: 'TRUE' })
// =============================================================================

function test_pulseOneEpisode(euid, flagOverrides) {
  var AGENT = 'Daily_Pulse';
  if (!euid) euid = ACTIVE_EP_UID;
  console.log('=== PULSE HARNESS: ' + euid + ' START ===');
  console.log('Flag overrides: ' + (flagOverrides ? JSON.stringify(flagOverrides) : 'none (reading real flags)'));

  // Set override sentinels. getGovernance() must have the _DEV_OVERRIDE path active.
  var overrideKeys = flagOverrides ? Object.keys(flagOverrides) : [];
  for (var k = 0; k < overrideKeys.length; k++) {
    PropertiesService.getScriptProperties()
      .setProperty('_DEV_OVERRIDE_' + overrideKeys[k], String(flagOverrides[overrideKeys[k]]));
  }
  if (overrideKeys.length) console.log('[HARNESS] Sentinels set: ' + overrideKeys.join(', '));

  try {
    var epRow = getEpisodeRow(euid);
    if (!epRow) { console.log('[ABORT] Episode not found: ' + euid); return; }

    var status    = String(epRow.Status               || '');
    var guestName = String(epRow.Guest_Name           || euid);
    var contactId = String(epRow.Contact_ID           || '');
    var prodFolId = String(epRow.Production_Folder_ID || '');
    var recDate   = epRow.Recording_Date              || null;
    var relDate   = epRow.Release_Date                || null;
    var finalEpId = String(epRow.Final_Episode_ID     || '');

    console.log('[EPISODE] Status=' + status + ' | Guest=' + guestName + ' | Folder=' + (prodFolId || '(blank)'));

    if (!status || status === 'archived') {
      console.log('[SKIP ALL] Status "' + status + '" — not pulse-active');
      return;
    }

    // Build snapshot (mirrors dailyPulse() per-run setup)
    var sheetId    = getMasterSheetId();
    var ss         = SpreadsheetApp.openById(sheetId);
    var tasksSheet = ss.getSheetByName('Tasks');
    var tasksData  = tasksSheet ? tasksSheet.getDataRange().getValues() : [];
    var tH         = tasksData.length > 0 ? tasksData[0] : [];

    var taskEpUidCol    = tH.indexOf('Episode_UID');
    var taskStatusCol   = tH.indexOf('Status');
    var taskWorkflowCol = tH.indexOf('Workflow_Step');
    var taskIdCol       = tH.indexOf('Task_ID');
    var taskDueDateCol  = tH.indexOf('Due_Date');
    var hasTaskCols     = taskEpUidCol !== -1 && taskStatusCol !== -1 &&
                          taskWorkflowCol !== -1 && taskIdCol !== -1 && taskDueDateCol !== -1;

    var today    = new Date(); today.setHours(0, 0, 0, 0);
    var tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    var heavyBudget = parseInt(getGovernance('PULSE_HEAVY_PASS_BUDGET') || '2', 10) || 2;
    var heavyUsed   = 0;
    console.log('[CONFIG] PULSE_HEAVY_PASS_BUDGET=' + heavyBudget);

    // Stage 0: system-level calendar intake — no single-episode scope; skipped.
    console.log('---');
    console.log('[STAGE 0] SKIPPED — system-level; use test_checkCalendarForInterviews()');

    // =========================================================================
    // Stage 1: upcoming — recording reminders + transcript watch
    // =========================================================================
    if (status === 'upcoming') {
      console.log('---');
      console.log('[STAGE 1] upcoming');

      // Recording reminders
      var rrRaw = String(getGovernance('PULSE_RECORDING_REMINDERS_ENABLED') || '');
      if (rrRaw.toUpperCase() !== 'TRUE') {
        console.log('[STAGE 1 > Recording_Reminder] SKIPPED — flag off (PULSE_RECORDING_REMINDERS_ENABLED=' + rrRaw + ')');
      } else if (!recDate) {
        console.log('[STAGE 1 > Recording_Reminder] SKIPPED — upstream state absent (Recording_Date blank)');
      } else if (!hasTaskCols) {
        console.log('[STAGE 1 > Recording_Reminder] SKIPPED — Tasks tab missing required columns');
      } else {
        console.log('[STAGE 1 > Recording_Reminder] FIRED → _pulse_recordingReminders()');
        _pulse_recordingReminders(
          euid, guestName, contactId, recDate,
          today, tomorrow, tasksData, tasksSheet,
          taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, AGENT
        );
      }

      // Transcript watch → status flip + content chain + reel chain
      if (!prodFolId) {
        console.log('[STAGE 1 > Transcript_Watch] SKIPPED — upstream state absent (Production_Folder_ID blank)');
        console.log('[STAGE 1 > Content_Chain]    SKIPPED — no folder');
        console.log('[STAGE 1 > Reel_Chain]       SKIPPED — no folder');
      } else {
        var transcriptFound = _pulse_detectTranscript(prodFolId);
        if (!transcriptFound) {
          console.log('[STAGE 1 > Transcript_Watch] SKIPPED — no transcript in Episode/ subfolder');
          console.log('[STAGE 1 > Content_Chain]    SKIPPED — no transcript detected');
          console.log('[STAGE 1 > Reel_Chain]       SKIPPED — no transcript detected');
        } else {
          console.log('[STAGE 1 > Transcript_Watch] FIRED — transcript found; flipping Status to in_production');
          patchEpisodes(euid, { Status: 'in_production' });
          _pulse_spawnUploadTask(euid, guestName, contactId, tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol);
          heavyUsed += _pulseHarness_runContentChain(euid, guestName, prodFolId, AGENT, heavyBudget, heavyUsed, 1);
          _pulseHarness_runReelChain(euid, guestName, AGENT, 1);
        }
      }
    }

    // =========================================================================
    // Stage 2: in_production — content chain + reel chain
    // =========================================================================
    else if (status === 'in_production') {
      console.log('---');
      console.log('[STAGE 2] in_production');

      if (!prodFolId) {
        console.log('[STAGE 2 > Content_Chain] SKIPPED — upstream state absent (Production_Folder_ID blank)');
        console.log('[STAGE 2 > Reel_Chain]    SKIPPED — upstream state absent (Production_Folder_ID blank)');
      } else {
        _pulse_spawnUploadTask(euid, guestName, contactId, tasksData, taskEpUidCol, taskStatusCol, taskWorkflowCol);
        heavyUsed += _pulseHarness_runContentChain(euid, guestName, prodFolId, AGENT, heavyBudget, heavyUsed, 2);
        _pulseHarness_runReelChain(euid, guestName, AGENT, 2);
        console.log('[STAGE 2] Done. Total heavy passes this run: ' + heavyUsed + '/' + heavyBudget);
      }
    }

    // =========================================================================
    // Stage 3: review — release reminders + final-video detect (backup path)
    // =========================================================================
    else if (status === 'review') {
      console.log('---');
      console.log('[STAGE 3] review');

      // Release reminders
      var rrelRaw = String(getGovernance('PULSE_RELEASE_REMINDERS_ENABLED') || '');
      if (rrelRaw.toUpperCase() !== 'TRUE') {
        console.log('[STAGE 3 > Release_Reminder] SKIPPED — flag off (PULSE_RELEASE_REMINDERS_ENABLED=' + rrelRaw + ')');
      } else if (!relDate) {
        console.log('[STAGE 3 > Release_Reminder] SKIPPED — upstream state absent (Release_Date blank)');
      } else if (!hasTaskCols) {
        console.log('[STAGE 3 > Release_Reminder] SKIPPED — Tasks tab missing required columns');
      } else {
        console.log('[STAGE 3 > Release_Reminder] FIRED → _pulse_releaseReminders()');
        _pulse_releaseReminders(
          euid, guestName, contactId, relDate,
          today, tomorrow, tasksData, tasksSheet,
          taskEpUidCol, taskStatusCol, taskWorkflowCol, taskIdCol, taskDueDateCol, AGENT
        );
      }

      // Final-video detect: backup to UI Complete button
      if (finalEpId) {
        console.log('[STAGE 3 > Final_Video_Detect] SKIPPED — already exists (Final_Episode_ID populated, idempotent)');
      } else if (!prodFolId) {
        console.log('[STAGE 3 > Final_Video_Detect] SKIPPED — upstream state absent (Production_Folder_ID blank)');
      } else {
        console.log('[STAGE 3 > Final_Video_Detect] FIRED → completeFinalEpisodeUpload() (no Final_Episode_ID yet)');
        try {
          var r = completeFinalEpisodeUpload(euid);
          if (r && r.ok) {
            console.log('[STAGE 3 > Final_Video_Detect] succeeded');
          } else if (r && r.error && !r.error.includes('No file found')) {
            console.log('[STAGE 3 > Final_Video_Detect] returned error: ' + r.error);
          } else {
            console.log('[STAGE 3 > Final_Video_Detect] SKIPPED — no final-video file found in folder');
          }
        } catch(e) {
          console.log('[STAGE 3 > Final_Video_Detect] ERROR: ' + e.message);
        }
      }
    }

    // =========================================================================
    // Stage 4: ready_to_release — no pulse action
    // =========================================================================
    else if (status === 'ready_to_release') {
      console.log('---');
      console.log('[STAGE 4] ready_to_release — no pulse action');
    }

    else {
      console.log('---');
      console.log('[STAGE ?] Status "' + status + '" — no pulse action defined');
    }

    console.log('=== PULSE HARNESS: ' + euid + ' COMPLETE ===');

  } finally {
    // Always clear override sentinels, even on error.
    for (var c = 0; c < overrideKeys.length; c++) {
      try { PropertiesService.getScriptProperties().deleteProperty('_DEV_OVERRIDE_' + overrideKeys[c]); } catch(e) {}
    }
    if (overrideKeys.length) console.log('[HARNESS] Override sentinels cleared');
  }
}


/**
 * Logs content chain pre-call state and calls _pulse_contentChain.
 * Returns heavy passes fired (from _pulse_contentChain return value).
 * Handles flag check and budget check with verbose SKIPPED/FIRED reasoning.
 */
function _pulseHarness_runContentChain(epUid, guestName, prodFolderId, agentName, heavyBudget, heavyUsed, stage) {
  var cfRaw    = String(getGovernance('PULSE_CONTENT_ENABLED') || '');
  var pfx      = '[STAGE ' + stage + ' > Content_Chain]';
  var budgetLeft = heavyBudget - heavyUsed;

  if (cfRaw.toUpperCase() !== 'TRUE') {
    console.log(pfx + ' SKIPPED — flag off (PULSE_CONTENT_ENABLED=' + cfRaw + ')');
    return 0;
  }
  if (budgetLeft <= 0) {
    console.log(pfx + ' SKIPPED — budget exhausted (' + heavyUsed + '/' + heavyBudget + ' heavy passes used)');
    return 0;
  }

  // Read manifest to preview per-track state before calling
  var manifest = null;
  try { manifest = getManifest(prodFolderId); } catch(e) { /* unreadable — chain will handle it */ }
  var hasIndex  = !!(manifest && manifest.episode_index_v2);
  var hasNotes  = !!(manifest && manifest.show_notes);
  var hasGraphs = !!(manifest && manifest.quote_graphic_assets_built);

  console.log(pfx + ' FIRED → _pulse_contentChain() | budget remaining: ' + budgetLeft);
  if (!hasIndex) {
    console.log(pfx + ' | Track_A (buildEpisodeIndexV2):      will FIRE — no index v2 yet');
    if (budgetLeft >= 2) {
      console.log(pfx + ' | Track_B (runEditorialPass):         will FIRE if Track_A succeeds — budget covers both');
    } else {
      console.log(pfx + ' | Track_B (runEditorialPass):         SKIPPED — budget exhausted after Track A (1 remaining)');
    }
    console.log(pfx + ' | Track_C (materializeQuoteGraphics): ceiling held (Status >= Track B) — depends on Track B');
  } else if (!hasNotes) {
    console.log(pfx + ' | Track_A (buildEpisodeIndexV2):      already exists (idempotent)');
    console.log(pfx + ' | Track_B (runEditorialPass):         will FIRE — index v2 present, no show notes yet');
    console.log(pfx + ' | Track_C (materializeQuoteGraphics): ceiling held — depends on Track B');
  } else if (!hasGraphs) {
    console.log(pfx + ' | Track_A (buildEpisodeIndexV2):      already exists (idempotent)');
    console.log(pfx + ' | Track_B (runEditorialPass):         already exists (idempotent)');
    console.log(pfx + ' | Track_C (materializeQuoteGraphics): will FIRE — show notes present, no quote graphics yet (not budget-counted)');
  } else {
    console.log(pfx + ' | all tracks already complete (fully idempotent run expected)');
  }

  var fired = _pulse_contentChain(epUid, guestName, prodFolderId, agentName, budgetLeft);
  console.log(pfx + ' returned. Heavy passes fired: ' + fired);
  return fired;
}


/**
 * Logs reel chain pre-call state and calls _pulse_reelChain (or logs SKIPPED if flag off).
 */
function _pulseHarness_runReelChain(epUid, guestName, agentName, stage) {
  var rfRaw = String(getGovernance('PULSE_REELS_ENABLED') || '');
  var pfx   = '[STAGE ' + stage + ' > Reel_Chain]';
  if (rfRaw.toUpperCase() !== 'TRUE') {
    console.log(pfx + ' SKIPPED — flag off (PULSE_REELS_ENABLED=' + rfRaw + ')');
    return;
  }
  console.log(pfx + ' FIRED → _pulse_reelChain() (syncReelAssets → Gemini dual-output)');
  _pulse_reelChain(epUid, guestName, agentName);
  console.log(pfx + ' call returned');
}


// =============================================================================
// MAINTENANCE — Filing + folder repair
// =============================================================================

function test_repairStagingSubfolders() {
  repairStagingSubfolders(ACTIVE_EP_UID);
}

// Runs the full archive flow for a single episode (patch manifest + Episodes tab + move folder).
function test_runFilingFairy() {
  runFilingFairy(ACTIVE_EP_UID);
}

// Runs the full Sunday archive sweep (all live episodes past their promotion window).
function test_archiveLiveEpisodes() {
  archiveLiveEpisodes();
}

// =============================================================================
// MENDING FAIRY
// =============================================================================

// Runs the full Mending Fairy pass for a single episode.
// Reads the episode's current Status automatically so the pre-release guard
// behaves exactly as it does in the nightly housekeeping run.
function test_runMendingFairy() {
  var epRow = getEpisodeRow(ACTIVE_EP_UID);
  if (!epRow) {
    console.log('[test_runMendingFairy] Episode not found: ' + ACTIVE_EP_UID);
    return;
  }
  var status = String(epRow.Status || '');
  console.log('[test_runMendingFairy] START -- ' + ACTIVE_EP_UID + ' status=' + status);
  runMendingFairy(ACTIVE_EP_UID, status);
  console.log('[test_runMendingFairy] END');
}


// =============================================================================
// TASK PROJECTION MIGRATION
// =============================================================================

// One-time sweep: marks all open/in_progress reminder task rows complete.
// Run once after deploying the Task Projection spoke. Safe to re-run — idempotent.
function test_clearReminderRows() {
  var result = clearReminderRows();
  Logger.log('[test_clearReminderRows] cleared=' + result.cleared);
  return result;
}
