// =============================================================================
// DEV TOOLS — Manual Test Wrappers
// Never called by production code. Run from the Apps Script editor dropdown.
//
// USAGE: Paste the active episode UID into ACTIVE_EP_UID, then run any function.
//        System-level functions (dailyPulse, calendar) ignore the UID.
// =============================================================================

var ACTIVE_EP_UID = 'EP-260504-0736'; // ← paste UID here before running


// =============================================================================
// SYSTEM — No episode UID required
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
