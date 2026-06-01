// =============================================================================
// DEV TOOLS — Manual Test Wrappers
// Never called by production code. Run from the Apps Script editor dropdown.
//
// USAGE: Paste the active episode UID into ACTIVE_EP_UID, then run any function.
//        System-level functions (dailyPulse, calendar) ignore the UID.
// =============================================================================

var ACTIVE_EP_UID = 'EP-260430-1458'; // ← paste UID here before running


// =============================================================================
// SYSTEM — No episode UID required
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


// =============================================================================
// VERT FAIRY PIPELINE — Uses ACTIVE_EP_UID
// =============================================================================

// Track A: Episode Index v2 (Claude, extract-not-interpret posture)
// force: true trashes any existing v2 doc and rebuilds from scratch
function test_buildEpisodeIndexV2() {
  var result = buildEpisodeIndexV2(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Track B: Editorial Pass — requires Index v2 to exist first
function test_runEditorialPass() {
  var result = runEditorialPass(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Track C: Materialize quote graphic assets — requires Track B Show Notes Doc
function test_materializeQuoteGraphicAssets() {
  var result = materializeQuoteGraphicAssets(ACTIVE_EP_UID, { force: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Track C: Reel editorial pass — set force: true to rebuild even if already run
function test_runReelEditorialPass(force) {
  var result = runReelEditorialPass(ACTIVE_EP_UID, { force: !!force });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

// Reel sync: creates AL rows for MP4s in Staging/Reels/, then Gemini-summarizes each.
// Run this first, then test_runReelEditorialPass() to have Claude clean the summaries.
// If result.timedOut is true, re-run — it picks up where it left off.
function test_syncReelAssets() {
  var result = syncReelAssets(ACTIVE_EP_UID, { force: false });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}


// =============================================================================
// REELS SURFACE — Uses ACTIVE_EP_UID
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
// EPISODE UPLOAD — Uses ACTIVE_EP_UID
// =============================================================================

// Spawns an Upload_Produced_Episode task for the active episode.
// Set ACTIVE_EP_UID to Mai's UID, then run once from the editor dropdown.
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
// ARTIST FAIRY — Uses ACTIVE_EP_UID
// =============================================================================

function test_artistFairy() {
  console.log("[test_artistFairy] START — " + ACTIVE_EP_UID);
  runArtistFairy(ACTIVE_EP_UID);
  console.log("[test_artistFairy] END");
}

// Exports slides to PNG. Paste the presentation ID before running.
function test_exportSlidesToPng() {
  var DECK_ID = ''; // ← paste presentation ID here
  if (!DECK_ID) throw new Error("test_exportSlidesToPng: set DECK_ID before running.");
  exportSlidesToPng(DECK_ID);
}


// =============================================================================
// FOLDER REPAIR — Uses ACTIVE_EP_UID
// =============================================================================

function test_repairStagingSubfolders() {
  repairStagingSubfolders(ACTIVE_EP_UID);
}


// =============================================================================
// FILING — Uses ACTIVE_EP_UID
// =============================================================================

// Runs the full archive flow for a single episode (patch manifest + Episodes tab + move folder).
function test_runFilingFairy() {
  runFilingFairy(ACTIVE_EP_UID);
}

// Runs the full Sunday archive sweep (all live episodes past their promotion window).
function test_archiveLiveEpisodes() {
  archiveLiveEpisodes();
}
