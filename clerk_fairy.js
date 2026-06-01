
/**
 * DWYP Operations Platform — Clerk Fairy
 * File: clerk_fairy.gs
 * Version: 1.0 | March 2026
 *
 * Clerk owns doPost() exclusively. It receives incoming webhook payloads,
 * reads the 'type' field, and dispatches to the correct fairy.
 * No business logic lives here — Clerk only routes.
 *
 * Routes:
 *   type: "invite"  → scribeLetSchedule(contactId, episodeUid)
 *
 * Expected payload shape (JSON body):
 *   { "type": "invite", "contactId": "uuid", "episodeUid": "EP-250321-1400" }
 *
 * Dependencies:
 *   scribeLetSchedule()  — scribe_fairy.gs
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

  // ── Route ───────────────────────────────────────────────────
  if (type === "invite") {
    if (!contactId || !episodeUid) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "Clerk received 'invite' payload missing contactId or episodeUid.", "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Missing contactId or episodeUid for invite route." }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    logToAuditTrail(actor, "state_change", episodeUid, contactId,
      "Clerk dispatching to scribeLetSchedule for contact: " + contactId, "info");

    try {
      scribeLetSchedule(contactId, episodeUid);
    } catch (err) {
      logToAuditTrail(actor, "error", episodeUid, contactId,
        "scribeLetSchedule threw after Clerk dispatch: " + err.message, "error");
      return ContentService
        .createTextOutput(JSON.stringify({ status: "error", message: "Scribe Let's Schedule failed: " + err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: "ok", route: "invite", contactId: contactId, episodeUid: episodeUid }))
      .setMimeType(ContentService.MimeType.JSON);

  } else {
    // ── Unknown route ─────────────────────────────────────────
    logToAuditTrail(actor, "error", episodeUid, contactId,
      "Clerk received unknown payload type: " + type, "error");
    return ContentService
      .createTextOutput(JSON.stringify({ status: "error", message: "Unknown route type: " + type }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}



