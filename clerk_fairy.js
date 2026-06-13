
/**
 * DWYP Operations Platform — Clerk Fairy
 * File: clerk_fairy.gs
 * Version: 1.1 | June 2026
 *
 * Clerk owns doPost() exclusively. It receives incoming webhook payloads,
 * reads the 'type' field, and dispatches to the correct fairy.
 * No business logic lives here — Clerk only routes.
 *
 * Routes: none active — full rebuild queued (AD #24).
 *
 * Dependencies:
 *   logToAuditTrail()    — fairy_circle.gs
 */

function doPost(e) {
  var actor = "clerk_fairy:doPost";
  var payload;

  // ── Parse payload ───────────────────────────────────────────
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    logToAuditTrail(actor, "error", null, null,
      "Clerk received unparseable payload: " + err.message, "error");
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Invalid JSON payload." }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var type = payload.type;
  var episodeUid = payload.episodeUid || null;
  var contactId = payload.contactId || null;

  // ── No active routes — Clerk rebuild queued ─────────────────
  logToAuditTrail(actor, "error", episodeUid, contactId,
    "Clerk received payload type '" + type + "' — no active routes (Clerk rebuild queued, AD #24)", "error");
  return ContentService
    .createTextOutput(JSON.stringify({ status: "error", message: "No active routes. Clerk rebuild pending." }))
    .setMimeType(ContentService.MimeType.JSON);
}



